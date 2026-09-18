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
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AdminGuard, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
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
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minSpend?: number;

  /** 限量张数，-1 不限量 */
  @IsInt()
  total: number;

  /** 有效天数 */
  @IsInt()
  @Min(1)
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
      pendingWithdrawalAgg, commissionAgg, couponClaimed, reviewCount, disabledUsers,
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
      this.prisma.userCoupon.count({ where: { used: true } }),
      this.prisma.review.count(),
      this.prisma.user.count({ where: { disabled: true } }),
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
        skip: (Math.max(1, +page) - 1) * 20,
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
        skip: (Math.max(1, +page) - 1) * 20,
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
    await this.prisma.partner.update({ where: { id }, data: { auditStatus: 'approved' } });
    return { ok: true };
  }

  @Post('partners/:id/reject')
  async reject(@Param('id') id: string) {
    await this.prisma.partner.update({ where: { id }, data: { auditStatus: 'rejected' } });
    return { ok: true };
  }

  @Put('partners/:id/verify')
  async verify(@Param('id') id: string, @Body() body: { verified: boolean }) {
    await this.prisma.partner.update({ where: { id }, data: { verified: !!body.verified } });
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
        skip: (Math.max(1, +page) - 1) * 20,
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
        skip: (Math.max(1, +page) - 1) * 20,
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
    await this.prisma.dynamic.delete({ where: { id } });
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
    if (!w || w.status !== 'pending') throw new BadRequestException('申请不存在或已处理');
    await this.prisma.withdrawal.update({
      where: { id },
      data: { status: 'done', handledAt: new Date() },
    });
    return { ok: true };
  }

  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(@Param('id') id: string, @Body() body: { remark?: string }) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w || w.status !== 'pending') throw new BadRequestException('申请不存在或已处理');
    await this.prisma.$transaction([
      this.prisma.withdrawal.update({
        where: { id },
        data: { status: 'rejected', remark: body.remark, handledAt: new Date() },
      }),
      // 拒绝退回余额
      this.prisma.partner.update({
        where: { id: w.partnerId },
        data: { balance: { increment: w.amount } },
      }),
    ]);
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
    await this.prisma.banner.delete({ where: { id } });
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
        skip: (Math.max(1, +page) - 1) * 20,
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
    await this.prisma.coupon.delete({ where: { id } });
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
    if (Number(user.balance) + amount < 0) throw new BadRequestException('扣减后余额不能为负');
    const updated = await this.prisma.user.update({
      where: { id },
      data: { balance: { increment: amount } },
    });
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

  /** 管理员强制取消订单：已支付则退款 */
  @Post('orders/:id/cancel')
  async forceCancelOrder(@Param('id') id: string, @Body() body: { reason?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new BadRequestException('订单不存在');
    if (order.status === 'pending_payment') {
      await this.prisma.order.update({
        where: { id },
        data: { status: 'cancelled', cancelReason: body.reason ?? '管理员取消' },
      });
      if (order.userCouponId) {
        await this.prisma.userCoupon.update({
          where: { id: order.userCouponId },
          data: { used: false, usedAt: null, orderId: null },
        });
      }
      return { ok: true, status: 'cancelled' };
    }
    if (['pending_accept', 'pending_service'].includes(order.status)) {
      const ops: any[] = [
        this.prisma.order.update({
          where: { id },
          data: { status: 'refunded', cancelReason: body.reason ?? '管理员取消' },
        }),
      ];
      if (order.payMethod === 'balance') {
        ops.push(
          this.prisma.user.update({
            where: { id: order.userId },
            data: { balance: { increment: order.totalAmount } },
          }),
        );
      }
      if (order.userCouponId) {
        ops.push(
          this.prisma.userCoupon.update({
            where: { id: order.userCouponId },
            data: { used: false, usedAt: null, orderId: null },
          }),
        );
      }
      await this.prisma.$transaction(ops);
      return { ok: true, status: 'refunded' };
    }
    throw new BadRequestException('该状态不可取消（服务中/已完成请联系客服处理）');
  }

  /** ---------- 评价管理 ---------- */
  @Get('reviews')
  async reviews(@Query('page') page = '1') {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count(),
      this.prisma.review.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, +page) - 1) * 20,
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
    await this.prisma.review.delete({ where: { id } });
    const agg = await this.prisma.review.aggregate({
      where: { partnerId: review.partnerId },
      _avg: { rating: true },
    });
    await this.prisma.partner.update({
      where: { id: review.partnerId },
      data: { rating: Math.round((agg._avg.rating ?? 5) * 10) / 10 },
    });
    return { ok: true };
  }

  /** ---------- 玩伴推荐位/强制下线 ---------- */
  @Put('partners/:id/recommend')
  async recommendPartner(@Param('id') id: string, @Body() body: { recommended: boolean }) {
    await this.prisma.partner.update({ where: { id }, data: { recommended: !!body.recommended } });
    return { ok: true };
  }

  @Put('partners/:id/status')
  async setPartnerStatus(@Param('id') id: string, @Body() body: { status: string }) {
    if (!['available', 'rest'].includes(body.status)) throw new BadRequestException('非法状态');
    await this.prisma.partner.update({ where: { id }, data: { status: body.status } });
    return { ok: true };
  }
}
