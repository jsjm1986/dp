import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
      include: { services: true },
    });
    if (!partner) throw new NotFoundException('玩伴不存在');
    if (partner.status === 'rest') throw new BadRequestException('对方休息中，暂不可预约');
    if (partner.userId === userId) throw new BadRequestException('不能预约自己');

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

    const order = await this.prisma.order.create({
      data: {
        orderNo: genOrderNo(),
        userId,
        partnerId: dto.partnerId,
        appointAt: new Date(dto.appointAt),
        address: dto.address,
        remark: dto.remark,
        totalAmount,
        discount,
        userCouponId,
        items: { create: items },
      },
      include: ORDER_INCLUDE,
    });
    if (userCouponId) {
      await this.prisma.userCoupon.update({
        where: { id: userCouponId },
        data: { used: true, usedAt: new Date(), orderId: order.id },
      });
    }
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

  /** 支付：balance 余额扣款 / mock 模拟第三方支付 */
  async pay(userId: string, id: string, dto: PayOrderDto) {
    const order = await this.mustOwn(userId, id);
    this.mustBe(order.status, ORDER_STATUS.PENDING_PAYMENT, '订单状态不可支付');
    const method = dto.method === 'balance' ? 'balance' : 'mock';

    if (method === 'balance') {
      const total = Number(order.totalAmount);
      const [, updated] = await this.prisma.$transaction(async (tx) => {
        const res = await tx.user.updateMany({
          where: { id: userId, balance: { gte: total } },
          data: { balance: { decrement: total } },
        });
        if (!res.count) throw new BadRequestException('余额不足');
        return [
          res,
          await tx.order.update({
            where: { id },
            data: { status: ORDER_STATUS.PENDING_ACCEPT, paidAt: new Date(), payMethod: 'balance' },
            include: ORDER_INCLUDE,
          }),
        ];
      });
      if (DEMO_AUTO_FLOW) this.scheduleAutoFlow(id);
      return this.toDto(updated);
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: ORDER_STATUS.PENDING_ACCEPT, paidAt: new Date(), payMethod: 'mock' },
      include: ORDER_INCLUDE,
    });
    if (DEMO_AUTO_FLOW) this.scheduleAutoFlow(id);
    return this.toDto(updated);
  }

  async cancel(userId: string, id: string, dto: CancelOrderDto) {
    const order = await this.mustOwn(userId, id);
    const freeCancel = [ORDER_STATUS.PENDING_PAYMENT];
    const refundCancel = [ORDER_STATUS.PENDING_ACCEPT, ORDER_STATUS.PENDING_SERVICE];
    if (freeCancel.includes(order.status as never)) {
      const updated = await this.prisma.order.update({
        where: { id },
        data: { status: ORDER_STATUS.CANCELLED, cancelReason: dto.reason },
        include: ORDER_INCLUDE,
      });
      // 未支付取消：退还优惠券
      if (!order.paidAt && order.userCouponId) {
        await this.prisma.userCoupon.update({
          where: { id: order.userCouponId },
          data: { used: false, usedAt: null, orderId: null },
        });
      }
      return this.toDto(updated);
    }
    if (refundCancel.includes(order.status as never)) {
      // 已支付：退款；余额支付原路退回
      const ops: any[] = [
        this.prisma.order.update({
          where: { id },
          data: { status: ORDER_STATUS.REFUNDED, cancelReason: dto.reason },
          include: ORDER_INCLUDE,
        }),
      ];
      if (order.payMethod === 'balance') {
        ops.push(
          this.prisma.user.update({
            where: { id: userId },
            data: { balance: { increment: order.totalAmount } },
          }),
        );
      }
      const [updated] = await this.prisma.$transaction(ops);
      return this.toDto(updated);
    }
    throw new BadRequestException('当前状态不可取消');
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
    await this.prisma.order.update({ where: { id }, data: { urgedAt: new Date() } });
    return { ok: true };
  }

  /** 评价 */
  async review(userId: string, id: string, dto: ReviewDto) {
    const order = await this.mustOwn(userId, id);
    this.mustBe(order.status, ORDER_STATUS.DONE, '订单完成后才能评价');
    const review = await this.prisma.review.create({
      data: { orderId: id, userId, partnerId: order.partnerId, rating: dto.rating, content: dto.content },
    });
    const agg = await this.prisma.review.aggregate({
      where: { partnerId: order.partnerId },
      _avg: { rating: true },
      _count: true,
    });
    await this.prisma.partner.update({
      where: { id: order.partnerId },
      data: { rating: Math.round((agg._avg.rating ?? 5) * 10) / 10 },
    });
    return review;
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
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: t.to,
        ...(action === 'accept' ? { acceptedAt: new Date() } : {}),
        ...(action === 'finish' ? { finishedAt: new Date() } : {}),
      },
      include: ORDER_INCLUDE,
    });
    if (action === 'finish') {
      await this.prisma.partner.update({
        where: { id: partner.id },
        data: { serviceCount: { increment: 1 } },
      });
    }
    return this.toDto(updated);
  }

  /* ---------------- internals ---------------- */

  private scheduleAutoFlow(orderId: string) {
    const steps: Array<{ delay: number; action: 'accept' | 'start' | 'finish' }> = [
      { delay: DEMO_DELAY.accept, action: 'accept' },
      { delay: DEMO_DELAY.start, action: 'start' },
      { delay: DEMO_DELAY.finish, action: 'finish' },
    ];
    for (const step of steps) {
      setTimeout(async () => {
        try {
          const order = await this.prisma.order.findUnique({ where: { id: orderId } });
          if (!order) return;
          const expected = {
            accept: ORDER_STATUS.PENDING_ACCEPT,
            start: ORDER_STATUS.PENDING_SERVICE,
            finish: ORDER_STATUS.SERVING,
          }[step.action];
          if (order.status !== expected) return;
          const to = {
            accept: ORDER_STATUS.PENDING_SERVICE,
            start: ORDER_STATUS.SERVING,
            finish: ORDER_STATUS.DONE,
          }[step.action];
          await this.prisma.order.update({
            where: { id: orderId },
            data: {
              status: to,
              ...(step.action === 'accept' ? { acceptedAt: new Date() } : {}),
              ...(step.action === 'finish' ? { finishedAt: new Date() } : {}),
            },
          });
          if (step.action === 'finish') {
            await this.prisma.partner.update({
              where: { id: order.partnerId },
              data: { serviceCount: { increment: 1 } },
            });
          }
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
    items: Array<{ id: string; serviceId: string; name: string; price: unknown; unit: string; num: number; subtotal: unknown }>;
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
