import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { assertClean } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CancelOrderDto, CreateOrderDto, OrderItemDto, PayOrderDto, ReviewDto } from './dto.js';

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

// 演示模式：支付后自动流转 待接单→已接单(待服务)→服务中→已完成
const DEMO_AUTO_FLOW = process.env.DEMO_AUTO_FLOW !== 'false';
const DEMO_DELAY = { accept: 10_000, start: 30_000, finish: 90_000 };

const ORDER_INCLUDE = {
  items: true,
  partner: {
    include: { user: { select: { nickname: true, avatar: true } } },
  },
  review: true,
} as const;

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

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
        subtotal: Number(svc.price) * it.num,
      };
    });
    const goodsAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    if (dto.remark) assertClean(dto.remark, '备注');

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
      discount = Math.min(Number(uc.coupon.amount), goodsAmount);
      userCouponId = uc.id;
    }
    const totalAmount = goodsAmount - discount;

    // 下单与占券同一事务，条件更新防止并发重复用券
    const order = await this.prisma.$transaction(async (tx) => {
      if (userCouponId) {
        const claim = await tx.userCoupon.updateMany({
          where: { id: userCouponId, userId, used: false },
          data: { used: true, usedAt: new Date() },
        });
        if (!claim.count) throw new BadRequestException('优惠券已被使用');
      }
      const created = await tx.order.create({
        data: {
          orderNo: genOrderNo(),
          userId,
          partnerId: dto.partnerId,
          appointAt,
          address: dto.address,
          remark: dto.remark,
          totalAmount,
          discount,
          userCouponId,
          items: { create: items },
        },
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
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.userId !== userId) {
      const partner = await this.prisma.partner.findUnique({ where: { userId } });
      if (partner?.id !== order.partnerId) throw new ForbiddenException('无权查看');
    }
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
    const method = dto.method === 'balance' ? 'balance' : 'mock';
    const total = Number(order.totalAmount);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (method === 'balance') {
        const res = await tx.user.updateMany({
          where: { id: userId, balance: { gte: total } },
          data: { balance: { decrement: total } },
        });
        if (!res.count) throw new BadRequestException('余额不足');
      }
      const pay = await tx.order.updateMany({
        where: { id, status: ORDER_STATUS.PENDING_PAYMENT },
        data: { status: ORDER_STATUS.PENDING_ACCEPT, paidAt: new Date(), payMethod: method },
      });
      if (!pay.count) throw new BadRequestException('订单状态不可支付');
      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    });
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

    // 状态变更、余额退款、券释放在同一事务内；条件更新防止与支付/重复取消竞争
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
      }
      if (order.userCouponId) {
        await tx.userCoupon.update({
          where: { id: order.userCouponId },
          data: { used: false, usedAt: null, orderId: null },
        });
      }
      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    });
    return this.toDto(updated);
  }

  /** 加钟：服务中追加项目，生成关联子订单走正常支付 */
  async extend(userId: string, id: string, dto: { items: OrderItemDto[] }) {
    const order = await this.mustOwn(userId, id);
    if (![ORDER_STATUS.PENDING_SERVICE, ORDER_STATUS.SERVING].includes(order.status as never)) {
      throw new BadRequestException('仅待服务或服务中的订单可以加钟');
    }
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: order.partnerId },
      include: { services: true },
    });
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
        subtotal: Number(svc.price) * it.num,
      };
    });
    if (!items.length) throw new BadRequestException('请选择加钟项目');
    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const child = await this.prisma.order.create({
      data: {
        orderNo: genOrderNo(),
        userId,
        partnerId: order.partnerId,
        appointAt: order.appointAt,
        address: order.address,
        remark: `加钟（关联订单 ${order.orderNo}）`,
        totalAmount,
        parentId: order.id,
        items: { create: items },
      },
      include: ORDER_INCLUDE,
    });
    return this.toDto(child);
  }

  /** 催服务 */
  async urge(userId: string, id: string) {
    const order = await this.mustOwn(userId, id);
    if (![ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE].includes(order.status as never)) {
      throw new BadRequestException('当前状态不可催单');
    }
    const elapsed = Date.now() - order.createdAt.getTime();
    if (elapsed < 5 * 60 * 1000) throw new BadRequestException('下单5分钟之后才能催服务哦~');
    if (order.urgedAt && Date.now() - order.urgedAt.getTime() < 60 * 1000) {
      throw new BadRequestException('已催过单啦，请稍后再试');
    }
    await this.prisma.order.update({ where: { id }, data: { urgedAt: new Date() } });
    return { ok: true };
  }

  /** 评价：一单一条（orderId 唯一约束兜底），评价与评分重算同一事务 */
  async review(userId: string, id: string, dto: ReviewDto) {
    const order = await this.mustOwn(userId, id);
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
        user: { select: { id: true, nickname: true, avatar: true, mobile: true } },
      },
      take: 50,
    });
    return rows.map((o) => ({ ...this.toDto(o), customer: o.user }));
  }

  async partnerAct(userId: string, id: string, action: 'accept' | 'reject' | 'start' | 'finish') {
    const partner = await this.mustBePartner(userId);
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || order.partnerId !== partner.id) throw new NotFoundException('订单不存在');

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
    const updated = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.order.updateMany({
        where: { id, status: { in: t.from } },
        data: {
          status: t.to,
          ...(action === 'accept' ? { acceptedAt: new Date() } : {}),
          ...(action === 'finish' ? { finishedAt: new Date() } : {}),
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
        }
        if (order.userCouponId) {
          await tx.userCoupon.update({
            where: { id: order.userCouponId },
            data: { used: false, usedAt: null, orderId: null },
          });
        }
      }
      if (action === 'finish') {
        await this.settleFinish(tx, order);
      }
      return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
    });
    return this.toDto(updated);
  }

  /* ---------------- internals ---------------- */

  /** 完单结算（在调用方事务内执行）：玩伴入账 + 服务数 + 分销佣金 */
  private async settleFinish(
    tx: Prisma.TransactionClient,
    order: { id: string; userId: string; partnerId: string; totalAmount: unknown },
  ) {
    await tx.partner.update({
      where: { id: order.partnerId },
      data: {
        serviceCount: { increment: 1 },
        balance: { increment: Number(order.totalAmount) },
      },
    });
    // 分销：下线完成订单，推荐人按比例拿佣金入余额；佣金按订单唯一防重复结算
    const buyer = await tx.user.findUnique({
      where: { id: order.userId },
      select: { inviterId: true },
    });
    if (!buyer?.inviterId) return;
    const exists = await tx.commission.findUnique({ where: { orderId: order.id } });
    if (exists) return;
    const rateRow = await tx.setting.findUnique({ where: { key: 'commissionRate' } });
    const rate = Math.min(Math.max(Number(rateRow?.value ?? 5), 0), 50) / 100;
    if (rate <= 0) return;
    const amount = Math.round(Number(order.totalAmount) * rate * 100) / 100;
    if (amount <= 0) return;
    await tx.commission.create({
      data: { inviterId: buyer.inviterId, inviteeId: order.userId, orderId: order.id, amount, rate },
    });
    await tx.user.update({
      where: { id: buyer.inviterId },
      data: { balance: { increment: amount } },
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
              await this.settleFinish(tx, order);
            }
          });
        } catch {
          /* demo flow best-effort */
        }
      }, step.delay);
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
      reviewed: !!o.review,
      createdAt: o.createdAt,
    };
  }
}

function genOrderNo() {
  const t = new Date();
  const ymd = [t.getFullYear(), t.getMonth() + 1, t.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('');
  return `DP${ymd}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}
