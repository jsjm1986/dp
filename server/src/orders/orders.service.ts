import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { bjDateKey, bjDayStart, logBalance, orderRange } from '../common/ledger.js';
import { notify, type PendingNotice } from '../common/notify.js';
import { assertClean } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CancelOrderDto, CreateOrderDto, ExtendOrderDto, PayOrderDto, ReviewDto } from './dto.js';

export const ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  PENDING_ACCEPT: 'pending_accept',
  PENDING_SERVICE: 'pending_service',
  SERVING: 'serving',
  DONE: 'done',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  REFUNDED: 'refunded',
} as const;

const IS_PROD = process.env.NODE_ENV === 'production';
// 演示模式：支付后自动流转 待接单→已接单(待服务)→服务中→已完成；生产环境强制关闭
const DEMO_AUTO_FLOW = !IS_PROD && process.env.DEMO_AUTO_FLOW !== 'false';
const DEMO_DELAY = { accept: 10_000, start: 30_000, finish: 90_000 };
// 待支付订单超时时间（与前端"请在30分钟内完成支付"一致）
const PAY_TIMEOUT_MS = 30 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

const ORDER_INCLUDE = {
  items: true,
  partner: {
    include: { user: { select: { nickname: true, avatar: true } } },
  },
  review: true,
} as const;

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  /** 进程重启后恢复演示自动流转：setTimeout 只活在进程内，重启补调度存量在途订单 */
  async onModuleInit() {
    if (!DEMO_AUTO_FLOW) return;
    try {
      const stuck = await this.prisma.order.findMany({
        where: { status: { in: [ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE, ORDER_STATUS.SERVING] } },
        select: { id: true },
      });
      for (const o of stuck) this.scheduleAutoFlow(o.id);
    } catch {
      /* best-effort */
    }
  }

  async create(userId: string, dto: CreateOrderDto) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: dto.partnerId },
      include: { services: true, user: { select: { disabled: true } } },
    });
    if (!partner || partner.auditStatus !== 'approved' || partner.user.disabled) {
      throw new NotFoundException('玩伴不存在');
    }
    if (partner.status === 'rest') throw new BadRequestException('对方休息中，暂不可预约');
    if (partner.userId === userId) throw new BadRequestException('不能预约自己');
    // 任一方向拉黑即不可下单（与私信/详情可见性口径一致）
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { userId, blockedId: partner.userId },
          { userId: partner.userId, blockedId: userId },
        ],
      },
    });
    if (blocked) throw new BadRequestException('无法预约该玩伴');
    const appointAt = new Date(dto.appointAt);
    if (appointAt.getTime() <= Date.now()) {
      throw new BadRequestException('预约时间必须晚于当前时间');
    }

    const svcMap = new Map(partner.services.map((s) => [s.id, s]));
    const items = dto.items.map((it) => {
      const svc = svcMap.get(it.serviceId);
      if (!svc) throw new BadRequestException('服务项目不存在');
      if (it.num < svc.miniNum) {
        throw new BadRequestException(`「${svc.name}」最低起购 ${svc.miniNum} ${svc.unit}`);
      }
      return {
        serviceId: svc.id,
        name: svc.name,
        price: svc.price,
        unit: svc.unit,
        num: it.num,
        subtotal: round2(Number(svc.price) * it.num),
      };
    });
    const goodsAmount = round2(items.reduce((sum, i) => sum + i.subtotal, 0));
    if (dto.remark) assertClean(dto.remark, '备注');
    if (dto.address) assertClean(dto.address, '地址');

    // 优惠券抵扣
    let discount = 0;
    let userCouponId: string | undefined;
    if (dto.userCouponId) {
      const uc = await this.prisma.userCoupon.findUnique({
        where: { id: dto.userCouponId },
        include: { coupon: true },
      });
      if (!uc || uc.userId !== userId) throw new BadRequestException('优惠券不存在');
      if (uc.used) throw new BadRequestException('优惠券已使用');
      if (uc.coupon.expiresAt < new Date()) throw new BadRequestException('优惠券已过期');
      if (goodsAmount < Number(uc.coupon.minSpend)) {
        throw new BadRequestException(`满 ¥${Number(uc.coupon.minSpend)} 可用该券`);
      }
      discount = round2(Math.min(Number(uc.coupon.amount), goodsAmount));
      userCouponId = uc.id;
    }
    const totalAmount = round2(goodsAmount - discount);

    // 分销佣金率快照：下单时锁定，后续后台调比例不影响存量订单
    const buyer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { inviterId: true },
    });
    let commissionRate: number | undefined;
    if (buyer?.inviterId) {
      const rateRow = await this.prisma.setting.findUnique({ where: { key: 'commissionRate' } });
      // 0 也要快照：避免结算时回退到「当前费率」支付下单时未约定的佣金
      commissionRate = Math.min(Math.max(Number(rateRow?.value ?? 5), 0), 50) / 100;
    }

    // 下单与占券同一事务，条件更新防止并发重复用券；时段冲突在事务内复查（单连接串行写，天然防并发双订）
    const order = await this.prisma.$transaction(async (tx) => {
      const dayStart = bjDayStart(appointAt);
      // 玩伴设置的休息日（北京时间日期）当天不可预约
      const off = await tx.partnerOffDate.findUnique({
        where: { partnerId_date: { partnerId: partner.id, date: bjDateKey(appointAt) } },
      });
      if (off) throw new BadRequestException('对方当天休息，请更换日期');
      // 查询窗口向前扩一天：前一晚跨零点的订单也占用今日时段；
      // 待支付单只在支付有效期内占位——已超时但未清扫的单不封锁档期
      const taken = await tx.order.findMany({
        where: {
          partnerId: partner.id,
          appointAt: { gte: new Date(dayStart.getTime() - 86400_000), lt: new Date(dayStart.getTime() + 2 * 86400_000) },
          OR: [
            { status: { in: [ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE, ORDER_STATUS.SERVING] } },
            { status: ORDER_STATUS.PENDING_PAYMENT, createdAt: { gte: new Date(Date.now() - PAY_TIMEOUT_MS) } },
          ],
        },
        select: { appointAt: true, items: { select: { unit: true, num: true } } },
      });
      const wanted = orderRange(appointAt, items);
      const clash = taken.some((o) => {
        const r = orderRange(o.appointAt, o.items);
        return r.start < wanted.end && wanted.start < r.end;
      });
      if (clash) throw new BadRequestException('该时段已被预约，请更换时间');
      if (userCouponId) {
        const claim = await tx.userCoupon.updateMany({
          where: { id: userCouponId, userId, used: false },
          data: { used: true, usedAt: new Date() },
        });
        if (!claim.count) throw new BadRequestException('优惠券已被使用');
      }
      const created = await this.createOrderRow(tx, {
        userId,
        partnerId: dto.partnerId,
        appointAt,
        address: dto.address,
        remark: dto.remark,
        totalAmount,
        discount,
        userCouponId,
        commissionRate,
        items: { create: items },
      });
      if (userCouponId) {
        await tx.userCoupon.update({
          where: { id: userCouponId },
          data: { orderId: created.id },
        });
      }
      return tx.order.findUniqueOrThrow({
        where: { id: created.id },
        include: ORDER_INCLUDE,
      });
    });
    return this.toDto(order);
  }

  async myOrders(userId: string, status?: string, page = 1, pageSize = 10) {
    await this.expireStalePayments({ userId });
    const where = { userId, ...(status ? { status } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ORDER_INCLUDE,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((o) => this.toDto(o)) };
  }

  async detail(userId: string, id: string) {
    // 先鉴权再做懒过期副作用：避免任意登录用户触发他人订单的过期取消
    const pre = await this.prisma.order.findUnique({
      where: { id },
      select: { userId: true, partnerId: true },
    });
    if (!pre) throw new NotFoundException('订单不存在');
    if (pre.userId !== userId) {
      const partner = await this.prisma.partner.findUnique({ where: { userId } });
      if (partner?.id !== pre.partnerId) throw new ForbiddenException('无权查看');
    }
    await this.expireStalePayments({ id });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    const children = await this.prisma.order.findMany({
      where: { parentId: id },
      orderBy: { createdAt: 'asc' },
      include: { items: true },
    });
    return {
      ...this.toDto(order),
      children: children.map((c) => ({
        id: c.id,
        orderNo: c.orderNo,
        status: c.status,
        totalAmount: Number(c.totalAmount),
        items: c.items.map((i) => ({ name: i.name, num: i.num })),
        createdAt: c.createdAt,
      })),
    };
  }

  /** 支付：balance 余额扣款 / mock 模拟第三方支付；条件更新防并发重复支付 */
  async pay(userId: string, id: string, dto: PayOrderDto) {
    const order = await this.mustOwn(userId, id);
    if (dto.method === 'mock' && IS_PROD) {
      throw new BadRequestException('模拟支付仅限演示环境');
    }
    if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
      if (Date.now() - order.createdAt.getTime() > PAY_TIMEOUT_MS) {
        await this.expireStalePayments({ id });
        throw new BadRequestException('订单已超时取消，请重新下单');
      }
      // 加钟子单继承父单 appointAt（通常已在过去），豁免该校验
      if (!order.parentId && order.appointAt.getTime() <= Date.now()) {
        throw new BadRequestException('预约时间已过，无法支付');
      }
    }
    const total = Number(order.totalAmount);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.method === 'balance') {
        const res = await tx.user.updateMany({
          where: { id: userId, balance: { gte: total } },
          data: { balance: { decrement: total } },
        });
        if (!res.count) throw new BadRequestException('余额不足');
        await logBalance(tx, { userId, type: 'pay', amount: -total, refId: id, remark: `订单支付` });
      }
      const pay = await tx.order.updateMany({
        where: { id, status: ORDER_STATUS.PENDING_PAYMENT },
        data: { status: ORDER_STATUS.PENDING_ACCEPT, paidAt: new Date(), payMethod: dto.method },
      });
      if (!pay.count) throw new BadRequestException('订单状态不可支付');
      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    });
    const partnerUser = await this.prisma.partner.findUnique({
      where: { id: order.partnerId },
      select: { userId: true },
    });
    if (partnerUser) {
      await notify(this.prisma, {
        userId: partnerUser.userId,
        type: 'order',
        title: '新订单待接单',
        content: `订单 ${updated.orderNo} 已支付 ¥${Number(updated.totalAmount).toFixed(2)}，请及时接单`,
        refId: id,
      });
    }
    if (DEMO_AUTO_FLOW) this.scheduleAutoFlow(id);
    return this.toDto(updated);
  }

  async cancel(userId: string, id: string, dto: CancelOrderDto) {
    const order = await this.mustOwn(userId, id);
    const target = order.status === ORDER_STATUS.PENDING_PAYMENT
      ? ORDER_STATUS.CANCELLED
      : [ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE].includes(order.status as never)
        ? ORDER_STATUS.REFUNDED
        : null;
    if (!target) throw new BadRequestException('当前状态不可取消');
    if (dto.reason) assertClean(dto.reason, '取消原因');

    // 状态变更、余额退款、券释放、子订单级联在同一事务内；条件更新防止与支付/重复取消竞争
    const updated = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: target, cancelReason: dto.reason },
      });
      if (!transitioned.count) throw new BadRequestException('订单状态已变化，请刷新后重试');
      if (target === ORDER_STATUS.REFUNDED && order.payMethod === 'balance') {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: order.totalAmount } },
        });
        await logBalance(tx, { userId, type: 'refund', amount: Number(order.totalAmount), refId: id, remark: '取消退款' });
      }
      if (order.userCouponId) {
        await tx.userCoupon.update({
          where: { id: order.userCouponId },
          data: { used: false, usedAt: null, orderId: null },
        });
      }
      await this.cascadeChildren(tx, id, '主订单已取消');
      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    });
    if (target === ORDER_STATUS.REFUNDED) {
      const partnerUser = await this.prisma.partner.findUnique({
        where: { id: order.partnerId },
        select: { userId: true },
      });
      if (partnerUser) {
        await notify(this.prisma, {
          userId: partnerUser.userId,
          type: 'order',
          title: '订单已被用户取消',
          content: `订单 ${order.orderNo} 已被取消，退款 ¥${Number(order.totalAmount).toFixed(2)} 已原路退回`,
          refId: id,
        });
      }
    }
    return this.toDto(updated);
  }

  /** 加钟：服务中追加项目，生成关联子订单走正常支付；父单状态在事务内复查防竞态 */
  async extend(userId: string, id: string, dto: ExtendOrderDto) {
    const order = await this.mustOwn(userId, id);
    if (order.parentId) throw new BadRequestException('加钟订单不可再次加钟');
    if (![ORDER_STATUS.PENDING_SERVICE, ORDER_STATUS.SERVING].includes(order.status as never)) {
      throw new BadRequestException('仅待服务或服务中的订单可以加钟');
    }
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: order.partnerId },
      include: { services: true, user: { select: { disabled: true } } },
    });
    // 复查玩伴状态：下单后玩伴可能已被禁用/打回审核
    if (partner.auditStatus !== 'approved' || partner.user.disabled) {
      throw new BadRequestException('玩伴暂不可服务');
    }
    const svcMap = new Map(partner.services.map((s) => [s.id, s]));
    const items = dto.items.map((it) => {
      const svc = svcMap.get(it.serviceId);
      if (!svc) throw new BadRequestException('服务项目不存在');
      if (it.num < svc.miniNum) {
        throw new BadRequestException(`「${svc.name}」最低起购 ${svc.miniNum} ${svc.unit}`);
      }
      return {
        serviceId: svc.id,
        name: svc.name,
        price: svc.price,
        unit: svc.unit,
        num: it.num,
        subtotal: round2(Number(svc.price) * it.num),
      };
    });
    if (!items.length) throw new BadRequestException('请选择加钟项目');
    const totalAmount = round2(items.reduce((sum, i) => sum + i.subtotal, 0));
    const child = await this.prisma.$transaction(async (tx) => {
      // 事务内复查：父单可能在此期间被玩伴/管理员推进到终态
      const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!fresh || ![ORDER_STATUS.PENDING_SERVICE, ORDER_STATUS.SERVING].includes(fresh.status as never)) {
        throw new BadRequestException('父订单状态已变化，无法加钟');
      }
      const created = await this.createOrderRow(tx, {
        userId,
        partnerId: order.partnerId,
        appointAt: order.appointAt,
        address: order.address,
        remark: `加钟（关联订单 ${order.orderNo}）`,
        totalAmount,
        parentId: order.id,
        commissionRate: order.commissionRate ? Number(order.commissionRate) : undefined,
        items: { create: items },
      });
      return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: ORDER_INCLUDE });
    });
    return this.toDto(child);
  }

  /** 催服务：支付5分钟后可催，60秒内不可重复；条件更新防并发 */
  async urge(userId: string, id: string) {
    const order = await this.mustOwn(userId, id);
    const elapsed = Date.now() - (order.paidAt ?? order.createdAt).getTime();
    if (elapsed < 5 * 60 * 1000) throw new BadRequestException('支付5分钟之后才能催服务哦~');
    const res = await this.prisma.order.updateMany({
      where: {
        id,
        status: { in: [ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE] },
        OR: [{ urgedAt: null }, { urgedAt: { lt: new Date(Date.now() - 60 * 1000) } }],
      },
      data: { urgedAt: new Date() },
    });
    if (!res.count) {
      if (![ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE].includes(order.status as never)) {
        throw new BadRequestException('当前状态不可催单');
      }
      throw new BadRequestException('已催过单啦，请稍后再试');
    }
    return { ok: true };
  }

  /** 评价：一单一条（orderId 唯一约束兜底），评价与评分重算同一事务 */
  async review(userId: string, id: string, dto: ReviewDto) {
    const order = await this.mustOwn(userId, id);
    if (order.parentId) throw new BadRequestException('加钟订单请通过主订单评价');
    this.mustBe(order.status, ORDER_STATUS.DONE, '订单完成后才能评价');
    if (dto.content) assertClean(dto.content, '评价');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.create({
          data: { orderId: id, userId, partnerId: order.partnerId, rating: dto.rating, content: dto.content },
        });
        const agg = await tx.review.aggregate({
          where: { partnerId: order.partnerId },
          _avg: { rating: true },
        });
        await tx.partner.update({
          where: { id: order.partnerId },
          data: { rating: Math.round((agg._avg.rating ?? 5) * 10) / 10 },
        });
        return review;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('该订单已评价过');
      }
      throw e;
    }
  }

  /* ---------------- 玩伴端操作 ---------------- */

  async partnerOrders(userId: string, status?: string) {
    const partner = await this.mustBePartner(userId);
    const where = { partnerId: partner.id, ...(status ? { status } : {}) };
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        partner: { include: { user: { select: { nickname: true, avatar: true } } } },
        review: true,
        user: { select: { id: true, nickname: true, avatar: true } },
      },
      take: 50,
    });
    return rows.map((o) => ({ ...this.toDto(o), customer: o.user }));
  }

  async partnerAct(userId: string, id: string, action: 'accept' | 'reject' | 'start' | 'finish', reason?: string) {
    const partner = await this.mustBePartner(userId);
    if (partner.auditStatus === 'rejected') {
      throw new ForbiddenException('入驻审核已被拒绝，无法操作订单');
    }
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || order.partnerId !== partner.id) throw new NotFoundException('订单不存在');
    if (action === 'reject' && reason) assertClean(reason, '拒单原因');

    const transition: Record<typeof action, { from: string[]; to: string }> = {
      accept: { from: [ORDER_STATUS.PENDING_ACCEPT], to: ORDER_STATUS.PENDING_SERVICE },
      reject: { from: [ORDER_STATUS.PENDING_ACCEPT], to: ORDER_STATUS.REJECTED },
      start: { from: [ORDER_STATUS.PENDING_SERVICE], to: ORDER_STATUS.SERVING },
      finish: { from: [ORDER_STATUS.SERVING], to: ORDER_STATUS.DONE },
    };
    const t = transition[action];
    if (!t.from.includes(order.status)) {
      throw new BadRequestException('当前状态不允许该操作');
    }
    // 状态变更与副作用（退款/退券/完单结算）同一事务；条件更新防并发重复操作
    const pendingNotices: PendingNotice[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.order.updateMany({
        where: { id, status: { in: t.from } },
        data: {
          status: t.to,
          ...(action === 'accept' ? { acceptedAt: new Date() } : {}),
          ...(action === 'finish' ? { finishedAt: new Date() } : {}),
          ...(action === 'reject' ? { cancelReason: reason?.trim() || '玩伴拒单' } : {}),
        },
      });
      if (!transitioned.count) throw new BadRequestException('订单状态已变化，请刷新后重试');
      if (action === 'reject') {
        // 拒单（订单必然已支付）：余额支付原路退款 + 释放优惠券
        if (order.payMethod === 'balance') {
          await tx.user.update({
            where: { id: order.userId },
            data: { balance: { increment: order.totalAmount } },
          });
          await logBalance(tx, { userId: order.userId, type: 'refund', amount: Number(order.totalAmount), refId: id, remark: '玩伴拒单退款' });
        }
        if (order.userCouponId) {
          await tx.userCoupon.update({
            where: { id: order.userCouponId },
            data: { used: false, usedAt: null, orderId: null },
          });
        }
        await this.cascadeChildren(tx, id, '主订单被拒单');
      }
      if (action === 'finish') {
        await this.settleFinish(tx, order, pendingNotices);
      }
      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    });
    // 事务提交后再发通知：通知失败不拖垮已完成的业务事务
    for (const n of pendingNotices) await notify(this.prisma, n);
    const userNotice: Record<typeof action, string | null> = {
      accept: `玩伴已接单，订单 ${order.orderNo} 待服务`,
      reject: `玩伴已拒单，订单 ${order.orderNo} 款项已原路退回`,
      start: `订单 ${order.orderNo} 服务已开始`,
      finish: `订单 ${order.orderNo} 已完成，快去评价吧`,
    };
    const text = userNotice[action];
    if (text) {
      await notify(this.prisma, { userId: order.userId, type: 'order', title: '订单进度更新', content: text, refId: id });
    }
    if (action === 'finish') {
      await notify(this.prisma, {
        userId: partner.userId,
        type: 'wallet',
        title: '完单入账',
        content: `订单 ${order.orderNo} 完成，¥${Number(order.totalAmount).toFixed(2)} 已入账`,
        refId: id,
      });
    }
    return this.toDto(updated);
  }

  /* ---------------- internals ---------------- */

  /** 完单结算（在调用方事务内执行）：玩伴入账 + 服务数 + 分销佣金；佣金通知收集到 notices 由调用方在提交后发送 */
  private async settleFinish(
    tx: Prisma.TransactionClient,
    order: { id: string; orderNo: string; userId: string; partnerId: string; totalAmount: unknown; commissionRate: number | null },
    notices: PendingNotice[],
  ) {
    await tx.partner.update({
      where: { id: order.partnerId },
      data: {
        serviceCount: { increment: 1 },
        balance: { increment: Number(order.totalAmount) },
      },
    });
    await logBalance(tx, { partnerId: order.partnerId, type: 'income', amount: Number(order.totalAmount), refId: order.id, remark: '完单入账' });
    // 分销：下线完成订单，推荐人按比例拿佣金入余额；佣金按订单唯一防重复结算
    const buyer = await tx.user.findUnique({
      where: { id: order.userId },
      select: { inviterId: true },
    });
    if (!buyer?.inviterId) return;
    const exists = await tx.commission.findUnique({ where: { orderId: order.id } });
    if (exists) return;
    const inviter = await tx.user.findUnique({
      where: { id: buyer.inviterId },
      select: { id: true, disabled: true },
    });
    if (!inviter || inviter.disabled) return; // 推荐人已注销/禁用则不结算
    // 优先用下单时的快照佣金率；存量无快照订单回退到当前全局配置
    let rate = order.commissionRate;
    if (rate == null) {
      const rateRow = await tx.setting.findUnique({ where: { key: 'commissionRate' } });
      rate = Math.min(Math.max(Number(rateRow?.value ?? 5), 0), 50) / 100;
    }
    if (rate <= 0) return;
    const amount = round2(Number(order.totalAmount) * rate);
    if (amount <= 0) return;
    await tx.commission.create({
      data: { inviterId: inviter.id, inviteeId: order.userId, orderId: order.id, amount, rate },
    });
    await tx.user.update({
      where: { id: inviter.id },
      data: { balance: { increment: amount } },
    });
    await logBalance(tx, { userId: inviter.id, type: 'commission', amount, refId: order.id, remark: `邀请佣金 ${(rate * 100).toFixed(0)}%` });
    notices.push({
      userId: inviter.id,
      type: 'commission',
      title: '佣金到账',
      content: `下线订单 ${order.orderNo} 完成，佣金 ¥${amount.toFixed(2)} 已入余额`,
      refId: order.id,
    });
  }

  private scheduleAutoFlow(orderId: string) {
    const steps: Array<{ delay: number; action: 'accept' | 'start' | 'finish' }> = [
      { delay: DEMO_DELAY.accept, action: 'accept' },
      { delay: DEMO_DELAY.start, action: 'start' },
      { delay: DEMO_DELAY.finish, action: 'finish' },
    ];
    for (const step of steps) {
      setTimeout(async () => {
        try {
          const expected = {
            accept: ORDER_STATUS.PENDING_ACCEPT,
            start: ORDER_STATUS.PENDING_SERVICE,
            finish: ORDER_STATUS.SERVING,
          }[step.action];
          const to = {
            accept: ORDER_STATUS.PENDING_SERVICE,
            start: ORDER_STATUS.SERVING,
            finish: ORDER_STATUS.DONE,
          }[step.action];
          // 条件更新保证手动操作优先；自动流转与完单结算同一事务
          const pendingNotices: PendingNotice[] = [];
          await this.prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({ where: { id: orderId } });
            if (!order || order.status !== expected) return;
            await tx.order.updateMany({
              where: { id: orderId, status: expected },
              data: {
                status: to,
                ...(step.action === 'accept' ? { acceptedAt: new Date() } : {}),
                ...(step.action === 'finish' ? { finishedAt: new Date() } : {}),
              },
            });
            if (step.action === 'finish') {
              await this.settleFinish(tx, order, pendingNotices);
            }
          });
          for (const n of pendingNotices) await notify(this.prisma, n);
        } catch {
          /* demo flow best-effort */
        }
      }, step.delay);
    }
  }

  /** 创建订单行：orderNo 理论可碰撞，P2002 时换新号重试 */
  private async createOrderRow(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.OrderUncheckedCreateInput, 'orderNo'>,
  ) {
    for (let i = 0; i < 3; i++) {
      try {
        return await tx.order.create({ data: { ...data, orderNo: genOrderNo() } });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new BadRequestException('订单号生成失败，请重试');
  }

  /** 懒过期：超时未支付订单转取消并释放优惠券（带条件更新，可安全并发调用） */
  private async expireStalePayments(scope: { userId?: string; id?: string }) {
    const stale = await this.prisma.order.findMany({
      where: {
        ...scope,
        status: ORDER_STATUS.PENDING_PAYMENT,
        createdAt: { lt: new Date(Date.now() - PAY_TIMEOUT_MS) },
      },
      select: { id: true, orderNo: true, userId: true, userCouponId: true },
      take: 50,
    });
    const pendingNotices: PendingNotice[] = [];
    for (const o of stale) {
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.order.updateMany({
          where: { id: o.id, status: ORDER_STATUS.PENDING_PAYMENT },
          data: { status: ORDER_STATUS.CANCELLED, cancelReason: '支付超时自动取消' },
        });
        if (res.count && o.userCouponId) {
          await tx.userCoupon.updateMany({
            where: { id: o.userCouponId, used: true },
            data: { used: false, usedAt: null, orderId: null },
          });
        }
        if (res.count) {
          pendingNotices.push({
            userId: o.userId,
            type: 'order',
            title: '订单超时取消',
            content: `订单 ${o.orderNo} 超时未支付，已自动取消`,
            refId: o.id,
          });
        }
      });
      for (const n of pendingNotices) await notify(this.prisma, n);
    }
  }

  /** 级联清理子订单：父单取消/拒单/退款时，未支付子单取消、已支付子单退款 */
  private async cascadeChildren(tx: Prisma.TransactionClient, parentId: string, reason: string) {
    const children = await tx.order.findMany({ where: { parentId } });
    for (const c of children) {
      if (c.status === ORDER_STATUS.PENDING_PAYMENT) {
        await tx.order.updateMany({
          where: { id: c.id, status: ORDER_STATUS.PENDING_PAYMENT },
          data: { status: ORDER_STATUS.CANCELLED, cancelReason: reason },
        });
      } else if (
        [ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE, ORDER_STATUS.SERVING].includes(c.status as never)
      ) {
        const res = await tx.order.updateMany({
          where: { id: c.id, status: c.status },
          data: { status: ORDER_STATUS.REFUNDED, cancelReason: reason },
        });
        if (res.count && c.payMethod === 'balance') {
          await tx.user.update({
            where: { id: c.userId },
            data: { balance: { increment: c.totalAmount } },
          });
          await logBalance(tx, { userId: c.userId, type: 'refund', amount: Number(c.totalAmount), refId: c.id, remark: reason });
        }
      }
    }
  }

  private async mustOwn(userId: string, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.userId !== userId) throw new ForbiddenException('无权操作');
    return order;
  }

  private async mustBePartner(userId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { userId } });
    if (!partner) throw new ForbiddenException('你不是玩伴');
    return partner;
  }

  private mustBe(actual: string, expected: string, msg: string) {
    if (actual !== expected) throw new BadRequestException(msg);
  }

  private toDto(o: {
    id: string;
    orderNo: string;
    partnerId: string;
    appointAt: Date;
    address: string | null;
    remark: string | null;
    totalAmount: unknown;
    status: string;
    cancelReason: string | null;
    urgedAt: Date | null;
    paidAt: Date | null;
    acceptedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    items: Array<{ id: string; serviceId: string | null; name: string; price: unknown; unit: string; num: number; subtotal: unknown }>;
    partner: { id: string; city: string; userId: string; user: { nickname: string; avatar: string | null } };
    review: { id: string } | null;
    discount: unknown;
    payMethod: string | null;
    parentId: string | null;
  }) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      partnerId: o.partnerId,
      partner: {
        id: o.partner.id,
        userId: o.partner.userId,
        nickname: o.partner.user.nickname,
        avatar: o.partner.user.avatar,
        city: o.partner.city,
      },
      items: o.items.map((i) => ({
        id: i.id,
        serviceId: i.serviceId,
        name: i.name,
        price: Number(i.price),
        unit: i.unit,
        num: i.num,
        subtotal: Number(i.subtotal),
      })),
      appointAt: o.appointAt,
      address: o.address,
      remark: o.remark,
      totalAmount: Number(o.totalAmount),
      discount: Number(o.discount),
      payMethod: o.payMethod,
      parentId: o.parentId,
      status: o.status,
      cancelReason: o.cancelReason,
      urgedAt: o.urgedAt,
      paidAt: o.paidAt,
      acceptedAt: o.acceptedAt,
      finishedAt: o.finishedAt,
      reviewed: !!o.review,
      createdAt: o.createdAt,
    };
  }
}

function genOrderNo() {
  // 订单号日期前缀按北京时间，与业务口径一致
  const ymd = bjDateKey(new Date()).replace(/-/g, '');
  return `DP${ymd}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}
