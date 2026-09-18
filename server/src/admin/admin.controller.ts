import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { randomBytes } from 'crypto';
import { AdminGuard, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { toInt } from '../common/params.js';
import { getSensitiveWords, setSensitiveWords } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';

class BannerDto {
  @IsString()
  image: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  link?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

class CouponDto {
  @IsString()
  @MaxLength(30)
  title: string;

  @IsNumber()
  @Min(0.1)
  @Max(100000)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000)
  minSpend?: number;

  /** 限量张数，-1 不限量 */
  @IsInt()
  @Min(-1)
  @Max(100000)
  total: number;

  /** 有效天数 */
  @IsInt()
  @Min(1)
  @Max(3650)
  days: number;
}

const userBrief = { id: true, mobile: true, nickname: true, avatar: true, city: true, role: true, disabled: true, createdAt: true } as const;

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private prisma: PrismaService) {}

  /** 运营仪表盘 */
  @Get('dashboard')
  async dashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      userCount, partnerApproved, partnerPending, orderCount, todayOrders,
      doneAgg, dynamicCount, messageCount, pendingAccept, serving,
      pendingWithdrawalAgg, commissionAgg, couponClaimed, reviewCount, disabledUsers, couponUsed,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.partner.count({ where: { auditStatus: 'approved' } }),
      this.prisma.partner.count({ where: { auditStatus: 'pending' } }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { createdAt: { gte: today } } }),
      this.prisma.order.aggregate({ where: { status: 'done' }, _sum: { totalAmount: true }, _count: true }),
      this.prisma.dynamic.count(),
      this.prisma.message.count(),
      this.prisma.order.count({ where: { status: 'pending_accept' } }),
      this.prisma.order.count({ where: { status: 'serving' } }),
      this.prisma.withdrawal.aggregate({ where: { status: 'pending' }, _sum: { amount: true }, _count: true }),
      this.prisma.commission.aggregate({ _sum: { amount: true }, _count: true }),
      this.prisma.userCoupon.count(),
      this.prisma.review.count(),
      this.prisma.user.count({ where: { disabled: true } }),
      this.prisma.userCoupon.count({ where: { used: true } }),
    ]);
    return {
      userCount,
      partnerApproved,
      partnerPending,
      orderCount,
      todayOrders,
      doneCount: doneAgg._count,
      gmv: Number(doneAgg._sum.totalAmount ?? 0),
      dynamicCount,
      messageCount,
      pendingAccept,
      serving,
      pendingWithdrawals: pendingWithdrawalAgg._count,
      pendingWithdrawalAmount: Number(pendingWithdrawalAgg._sum.amount ?? 0),
      commissionTotal: Number(commissionAgg._sum.amount ?? 0),
      commissionCount: commissionAgg._count,
      couponClaimed,
      couponUsed,
      reviewCount,
      disabledUsers,
    };
  }

  /** 用户列表 */
  @Get('users')
  async users(@Query('page') page = '1', @Query('keyword') keyword?: string) {
    const where: any = keyword
      ? { OR: [{ nickname: { contains: keyword } }, { mobile: { contains: keyword } }] }
      : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 20,
        take: 20,
        select: { ...userBrief, balance: true, partner: { select: { id: true, auditStatus: true } }, _count: { select: { orders: true } } },
      }),
    ]);
    return {
      total,
      items: rows.map((u) => ({
        ...u,
        balance: Number(u.balance),
        partnerId: u.partner?.id ?? null,
        auditStatus: u.partner?.auditStatus ?? null,
        orderCount: u._count.orders,
        partner: undefined,
        _count: undefined,
      })),
    };
  }

  /** 玩伴审核列表 */
  @Get('partners')
  async partners(@Query('auditStatus') auditStatus = 'pending', @Query('page') page = '1') {
    const where: any = auditStatus === 'all' ? {} : { auditStatus };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.partner.count({ where }),
      this.prisma.partner.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 20,
        take: 20,
        include: {
          user: { select: { nickname: true, avatar: true, mobile: true, gender: true } },
          services: { orderBy: { sort: 'asc' } },
        },
      }),
    ]);
    return {
      total,
      items: rows.map((p) => ({
        id: p.id,
        userId: p.userId,
        nickname: p.user.nickname,
        avatar: p.user.avatar,
        mobile: p.user.mobile,
        city: p.city,
        district: p.district,
        bio: p.bio,
        tags: JSON.parse(p.tags) as string[],
        photos: JSON.parse(p.photos) as string[],
        auditStatus: p.auditStatus,
        status: p.status,
        verified: p.verified,
        recommended: p.recommended,
        rating: p.rating,
        serviceCount: p.serviceCount,
        createdAt: p.createdAt,
        services: p.services.map((s) => ({ name: s.name, price: Number(s.price), unit: s.unit, miniNum: s.miniNum })),
      })),
    };
  }

  @Post('partners/:id/approve')
  async approve(@Param('id') id: string) {
    const res = await this.prisma.partner.updateMany({ where: { id }, data: { auditStatus: 'approved' } });
    if (!res.count) throw new BadRequestException('玩伴不存在');
    return { ok: true };
  }

  @Post('partners/:id/reject')
  async reject(@Param('id') id: string) {
    const res = await this.prisma.partner.updateMany({ where: { id }, data: { auditStatus: 'rejected' } });
    if (!res.count) throw new BadRequestException('玩伴不存在');
    return { ok: true };
  }

  @Put('partners/:id/verify')
  async verify(@Param('id') id: string, @Body() body: { verified: boolean }) {
    const res = await this.prisma.partner.updateMany({ where: { id }, data: { verified: !!body.verified } });
    if (!res.count) throw new BadRequestException('玩伴不存在');
    return { ok: true };
  }

  /** 全部订单 */
  @Get('orders')
  async orders(
    @Query('page') page = '1',
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    if (keyword) where.orderNo = { contains: keyword };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 20,
        take: 20,
        include: {
          user: { select: { nickname: true, mobile: true } },
          partner: { select: { user: { select: { nickname: true } }, city: true } },
        },
      }),
    ]);
    return {
      total,
      items: rows.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        customer: o.user.nickname,
        customerMobile: o.user.mobile,
        partner: o.partner.user.nickname,
        city: o.partner.city,
        totalAmount: Number(o.totalAmount),
        status: o.status,
        createdAt: o.createdAt,
      })),
    };
  }

  /** 动态管理 */
  @Get('dynamics')
  async dynamics(@Query('page') page = '1') {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dynamic.count(),
      this.prisma.dynamic.findMany({
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 20,
        take: 20,
        include: { user: { select: { nickname: true, avatar: true } } },
      }),
    ]);
    return {
      total,
      items: rows.map((d) => ({
        id: d.id,
        content: d.content,
        images: JSON.parse(d.images) as string[],
        city: d.city,
        likeCount: d.likeCount,
        commentCount: d.commentCount,
        createdAt: d.createdAt,
        author: d.user.nickname,
        avatar: d.user.avatar,
      })),
    };
  }

  @Delete('dynamics/:id')
  async deleteDynamic(@Param('id') id: string) {
    const res = await this.prisma.dynamic.deleteMany({ where: { id } });
    if (!res.count) throw new BadRequestException('动态不存在');
    return { ok: true };
  }

  /** 提现审核 */
  @Get('withdrawals')
  async withdrawals(@Query('status') status = 'pending') {
    const where: any = status === 'all' ? {} : { status };
    const rows = await this.prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { partner: { include: { user: { select: { nickname: true, avatar: true, mobile: true } } } } },
    });
    return rows.map((w) => ({
      id: w.id,
      amount: Number(w.amount),
      status: w.status,
      remark: w.remark,
      createdAt: w.createdAt,
      handledAt: w.handledAt,
      partner: {
        id: w.partner.id,
        nickname: w.partner.user.nickname,
        avatar: w.partner.user.avatar,
        mobile: w.partner.user.mobile,
      },
    }));
  }

  @Post('withdrawals/:id/approve')
  async approveWithdrawal(@Param('id') id: string) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw new BadRequestException('申请不存在');
    const res = await this.prisma.withdrawal.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'done', handledAt: new Date() },
    });
    if (!res.count) throw new BadRequestException('该申请已处理');
    return { ok: true };
  }

  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(@Param('id') id: string, @Body() body: { remark?: string }) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw new BadRequestException('申请不存在');
    // 条件更新+同事务退款，防并发重复退款
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.withdrawal.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'rejected', remark: body.remark, handledAt: new Date() },
      });
      if (!res.count) throw new BadRequestException('该申请已处理');
      await tx.partner.update({
        where: { id: w.partnerId },
        data: { balance: { increment: w.amount } },
      });
    });
    return { ok: true };
  }

  /** Banner 管理 */
  @Get('banners')
  async banners() {
    return this.prisma.banner.findMany({ orderBy: { sort: 'asc' } });
  }

  @Post('banners')
  async createBanner(@Body() dto: BannerDto) {
    return this.prisma.banner.create({ data: { image: dto.image, link: dto.link, sort: dto.sort ?? 0 } });
  }

  @Put('banners/:id')
  async updateBanner(@Param('id') id: string, @Body() dto: BannerDto) {
    return this.prisma.banner.update({ where: { id }, data: { image: dto.image, link: dto.link, sort: dto.sort } });
  }

  @Delete('banners/:id')
  async deleteBanner(@Param('id') id: string) {
    const res = await this.prisma.banner.deleteMany({ where: { id } });
    if (!res.count) throw new BadRequestException('Banner不存在');
    return { ok: true };
  }

  /** ---------- 系统设置 ---------- */
  @Get('settings')
  async settings() {
    const rows = await this.prisma.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      commissionRate: Number(map.get('commissionRate') ?? 5),
      sensitiveWords: getSensitiveWords(),
      commissionTotal: Number(
        (await this.prisma.commission.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0,
      ),
      commissionCount: await this.prisma.commission.count(),
    };
  }

  @Put('settings')
  async updateSettings(
    @Body() dto: { commissionRate?: number; sensitiveWords?: string[] | string },
  ) {
    if (dto.commissionRate !== undefined) {
      const rate = Math.min(Math.max(Number(dto.commissionRate) || 0, 0), 50);
      await this.prisma.setting.upsert({
        where: { key: 'commissionRate' },
        create: { key: 'commissionRate', value: String(rate) },
        update: { value: String(rate) },
      });
    }
    if (dto.sensitiveWords !== undefined) {
      const list = Array.isArray(dto.sensitiveWords)
        ? dto.sensitiveWords
        : String(dto.sensitiveWords).split(/[,，\n]+/).map((w) => w.trim()).filter(Boolean);
      await setSensitiveWords(this.prisma, list);
    }
    return this.settings();
  }

  /** 佣金明细（管理端可查全部） */
  @Get('commissions')
  async commissions(@Query('page') page = '1') {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.commission.count(),
      this.prisma.commission.findMany({
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 20,
        take: 20,
        include: { inviter: { select: { nickname: true, mobile: true } } },
      }),
    ]);
    const invitees = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.inviteeId) } },
      select: { id: true, nickname: true },
    });
    const orders = await this.prisma.order.findMany({
      where: { id: { in: rows.map((r) => r.orderId) } },
      select: { id: true, orderNo: true },
    });
    const nameOf = new Map(invitees.map((u) => [u.id, u.nickname]));
    const orderOf = new Map(orders.map((o) => [o.id, o.orderNo]));
    return {
      total,
      items: rows.map((c) => ({
        id: c.id,
        inviter: c.inviter.nickname,
        inviterMobile: c.inviter.mobile,
        invitee: nameOf.get(c.inviteeId) ?? '-',
        orderNo: orderOf.get(c.orderId) ?? '-',
        amount: Number(c.amount),
        rate: c.rate,
        createdAt: c.createdAt,
      })),
    };
  }

  /** ---------- 优惠券模板管理 ---------- */
  @Get('coupons')
  async coupons() {
    const rows = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { userCoupons: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      amount: Number(c.amount),
      minSpend: Number(c.minSpend),
      total: c.total,
      claimed: c._count.userCoupons,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
    }));
  }

  @Post('coupons')
  async createCoupon(@Body() dto: CouponDto) {
    const expiresAt = new Date(Date.now() + dto.days * 86400_000);
    return this.prisma.coupon.create({
      data: {
        title: dto.title,
        amount: dto.amount,
        minSpend: dto.minSpend ?? 0,
        total: dto.total,
        expiresAt,
      },
    });
  }

  @Delete('coupons/:id')
  async deleteCoupon(@Param('id') id: string) {
    // 领取数复查与删除同一事务，防与并发领券竞争
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.userCoupon.count({ where: { couponId: id } });
      if (claimed) throw new BadRequestException('该券已被用户领取，不能删除');
      const res = await tx.coupon.deleteMany({ where: { id } });
      if (!res.count) throw new BadRequestException('券不存在');
    });
    return { ok: true };
  }

  /** ---------- 用户禁用/启用 ---------- */
  @Put('users/:id/disabled')
  async toggleUserDisabled(@Param('id') id: string, @Body() body: { disabled: boolean }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('用户不存在');
    if (user.role === 'admin') throw new BadRequestException('不能禁用管理员');
    await this.prisma.user.update({ where: { id }, data: { disabled: !!body.disabled } });
    return { ok: true };
  }

  /** 用户角色变更（不能改自己） */
  @Put('users/:id/role')
  async setUserRole(@CurrentUser() adminId: string, @Param('id') id: string, @Body() body: { role: string }) {
    if (id === adminId) throw new BadRequestException('不能修改自己的角色');
    if (!['user', 'admin'].includes(body.role)) throw new BadRequestException('非法角色');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('用户不存在');
    if (user.role === 'admin') throw new BadRequestException('不能修改其他管理员的角色');
    await this.prisma.user.update({ where: { id }, data: { role: body.role } });
    return { ok: true };
  }

  /** 余额调整（正负均可，调整后不得低于 0） */
  @Post('users/:id/balance')
  async adjustBalance(@Param('id') id: string, @Body() body: { amount: number; remark?: string }) {
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!amount || Math.abs(amount) > 100000) throw new BadRequestException('金额无效');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('用户不存在');
    // 负数调整用条件更新防并发透支
    const res = await this.prisma.user.updateMany({
      where: { id, ...(amount < 0 ? { balance: { gte: -amount } } : {}) },
      data: { balance: { increment: amount } },
    });
    if (!res.count) throw new BadRequestException('扣减后余额不能为负');
    const updated = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return { balance: Number(updated.balance) };
  }

  /** 用户详情：资料 + 玩伴信息 + 近期订单 */
  @Get('users/:id')
  async userDetail(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, auditStatus: true, status: true, serviceCount: true, rating: true, balance: true } },
      },
    });
    if (!user) throw new BadRequestException('用户不存在');
    const [orders, orderCount, commissions] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, orderNo: true, totalAmount: true, status: true, createdAt: true },
      }),
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.commission.findMany({
        where: { inviterId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      id: user.id,
      mobile: user.mobile,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      city: user.city,
      role: user.role,
      disabled: user.disabled,
      balance: Number(user.balance),
      inviteCode: user.inviteCode,
      inviterId: user.inviterId,
      createdAt: user.createdAt,
      partner: user.partner
        ? { ...user.partner, balance: Number(user.partner.balance) }
        : null,
      orderCount,
      recentOrders: orders.map((o) => ({ ...o, totalAmount: Number(o.totalAmount) })),
      commissions: commissions.map((c) => ({ ...c, amount: Number(c.amount) })),
    };
  }

  /** 管理员强制取消/仲裁退款：未支付→取消，已支付(含服务中)→全额退款；级联处理加钟子订单 */
  @Post('orders/:id/cancel')
  async forceCancelOrder(@Param('id') id: string, @Body() body: { reason?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new BadRequestException('订单不存在');
    const reason = body.reason?.trim() || '管理员取消';
    const refundStatuses = ['pending_accept', 'pending_service', 'serving'];
    if (order.status !== 'pending_payment' && !refundStatuses.includes(order.status)) {
      throw new BadRequestException('该状态不可取消（已完成订单请线下处理）');
    }
    const target = order.status === 'pending_payment' ? 'cancelled' : 'refunded';
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: target, cancelReason: reason },
      });
      if (!res.count) throw new BadRequestException('订单状态已变化，请刷新后重试');
      if (target === 'refunded' && order.payMethod === 'balance') {
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
      // 级联：未支付子单取消、在途子单退款
      const children = await tx.order.findMany({ where: { parentId: id } });
      for (const c of children) {
        if (c.status === 'pending_payment') {
          await tx.order.updateMany({
            where: { id: c.id, status: 'pending_payment' },
            data: { status: 'cancelled', cancelReason: `主订单${reason}` },
          });
        } else if (refundStatuses.includes(c.status)) {
          const cr = await tx.order.updateMany({
            where: { id: c.id, status: c.status },
            data: { status: 'refunded', cancelReason: `主订单${reason}` },
          });
          if (cr.count && c.payMethod === 'balance') {
            await tx.user.update({
              where: { id: c.userId },
              data: { balance: { increment: c.totalAmount } },
            });
          }
        }
      }
    });
    return { ok: true, status: target };
  }

  /** ---------- 评价管理 ---------- */
  @Get('reviews')
  async reviews(@Query('page') page = '1') {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count(),
      this.prisma.review.findMany({
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 20,
        take: 20,
        include: {
          user: { select: { nickname: true, avatar: true } },
          partner: { include: { user: { select: { nickname: true } } } },
          order: { select: { orderNo: true } },
        },
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        reply: r.reply,
        createdAt: r.createdAt,
        author: r.user.nickname,
        avatar: r.user.avatar,
        partner: r.partner.user.nickname,
        orderNo: r.order.orderNo,
      })),
    };
  }

  /** 删除违规评价并重算玩伴评分 */
  @Delete('reviews/:id')
  async deleteReview(@Param('id') id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new BadRequestException('评价不存在');
    // 删除、重算、回写评分同一事务，防并发下评分过期
    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id } });
      const agg = await tx.review.aggregate({
        where: { partnerId: review.partnerId },
        _avg: { rating: true },
      });
      await tx.partner.update({
        where: { id: review.partnerId },
        data: { rating: Math.round((agg._avg.rating ?? 5) * 10) / 10 },
      });
    });
    return { ok: true };
  }

  /** ---------- 充值卡 ---------- */
  @Post('recharge-cards')
  async createRechargeCards(@Body() body: { amount: number; count: number }) {
    const amount = Math.round(Number(body.amount) * 100) / 100;
    const count = Math.min(Math.max(Math.floor(Number(body.count) || 1), 1), 500);
    if (!amount || amount <= 0 || amount > 100000) throw new BadRequestException('面额无效');
    const batch = `B${Date.now().toString(36).toUpperCase()}`;
    // 64bit 随机卡密；整批唯一约束碰撞时重新生成（最多 3 次）
    let cards: { code: string }[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        cards = await this.prisma.$transaction(
          Array.from({ length: count }, () =>
            this.prisma.rechargeCard.create({
              data: { code: 'DP' + randomBytes(8).toString('hex').toUpperCase(), amount, batch },
            }),
          ),
        );
        break;
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return { batch, count: cards.length, codes: cards.map((c) => c.code) };
  }

  @Get('recharge-cards')
  async rechargeCards(@Query('page') page = '1', @Query('status') status?: string) {
    const where: any = status === 'used' ? { usedById: { not: null } } : status === 'unused' ? { usedById: null } : {};
    const [total, rows, unusedCount] = await this.prisma.$transaction([
      this.prisma.rechargeCard.count({ where }),
      this.prisma.rechargeCard.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ((toInt(page, { def: 1, min: 1 }) ?? 1) - 1) * 30,
        take: 30,
        include: { usedBy: { select: { nickname: true, mobile: true } } },
      }),
      this.prisma.rechargeCard.count({ where: { usedById: null } }),
    ]);
    return {
      total,
      unusedCount,
      items: rows.map((c) => ({
        id: c.id,
        code: c.code,
        amount: Number(c.amount),
        batch: c.batch,
        used: !!c.usedById,
        usedBy: c.usedBy ? `${c.usedBy.nickname}(${c.usedBy.mobile})` : null,
        usedAt: c.usedAt,
        createdAt: c.createdAt,
      })),
    };
  }

  @Delete('recharge-cards/:id')
  async deleteRechargeCard(@Param('id') id: string) {
    // 条件删除：已被核销的卡不可删（防与并发核销竞争）
    const res = await this.prisma.rechargeCard.deleteMany({ where: { id, usedById: null } });
    if (!res.count) throw new BadRequestException('卡不存在或已被使用');
    return { ok: true };
  }

  /** ---------- 玩伴推荐位/强制下线 ---------- */
  @Put('partners/:id/recommend')
  async recommendPartner(@Param('id') id: string, @Body() body: { recommended: boolean }) {
    const res = await this.prisma.partner.updateMany({ where: { id }, data: { recommended: !!body.recommended } });
    if (!res.count) throw new BadRequestException('玩伴不存在');
    return { ok: true };
  }

  @Put('partners/:id/status')
  async setPartnerStatus(@Param('id') id: string, @Body() body: { status: string }) {
    if (!['available', 'rest'].includes(body.status)) throw new BadRequestException('非法状态');
    const partner = await this.prisma.partner.findUnique({ where: { id }, select: { auditStatus: true } });
    if (!partner) throw new BadRequestException('玩伴不存在');
    if (body.status === 'available' && partner.auditStatus !== 'approved') {
      throw new BadRequestException('审核通过后才能上线');
    }
    await this.prisma.partner.update({ where: { id }, data: { status: body.status } });
    return { ok: true };
  }
}
