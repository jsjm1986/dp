import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { logBalance } from '../common/ledger.js';
import { assertClean } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';

const IS_PROD = process.env.NODE_ENV === 'production';
// 卡密核销频限：同用户 10 分钟内最多错 10 次
const redeemFails = new Map<string, { count: number; resetAt: number }>();

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  avatar?: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  city?: string;
}

class BindInviterDto {
  @IsString()
  @MaxLength(20)
  code: string;
}

class RechargeDto {
  @IsNumber()
  @Min(1)
  @Max(10000)
  amount: number;
}

class RedeemDto {
  @IsString()
  @MaxLength(30)
  code: string;
}

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  @Get('profile')
  async profile(@CurrentUser() userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { partner: { select: { id: true } } },
    });
    return { ...this.auth.toProfile(user), partnerId: user.partner?.id ?? null };
  }

  /** 拉黑 */
  @Post('block/:id')
  async block(@CurrentUser() userId: string, @Param('id') blockedId: string) {
    if (blockedId === userId) throw new BadRequestException('不能拉黑自己');
    const target = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) throw new BadRequestException('用户不存在');
    await this.prisma.block.upsert({
      where: { userId_blockedId: { userId, blockedId } },
      create: { userId, blockedId },
      update: {},
    });
    return { blocked: true };
  }

  @Delete('block/:id')
  async unblock(@CurrentUser() userId: string, @Param('id') blockedId: string) {
    await this.prisma.block.deleteMany({ where: { userId, blockedId } });
    return { blocked: false };
  }

  @Get('blocks')
  async blocks(@CurrentUser() userId: string) {
    const rows = await this.prisma.block.findMany({ where: { userId } });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.blockedId) } },
      select: { id: true, nickname: true, avatar: true },
    });
    return users;
  }

  /** 客服账号（最早创建的管理员，确定性返回） */
  @Get('service')
  async service() {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'admin', disabled: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true, nickname: true, avatar: true },
    });
    return admin;
  }

  /** 绑定推荐人（只能绑一次，不能绑自己/环）；条件更新防并发重复绑定 */
  @Post('bind-inviter')
  async bindInviter(@CurrentUser() userId: string, @Body() dto: BindInviterDto) {
    const inviter = await this.prisma.user.findUnique({
      where: { inviteCode: dto.code.trim().toUpperCase() },
      select: { id: true, nickname: true, disabled: true, inviterId: true },
    });
    if (!inviter) throw new BadRequestException('邀请码不存在');
    if (inviter.disabled) throw new BadRequestException('该推荐人账号异常');
    if (inviter.id === userId) throw new BadRequestException('不能绑定自己');
    // 环检测：沿推荐链向上走，若回到自己则不能绑定（A→B→…→A）
    let cursor = inviter.inviterId;
    for (let i = 0; i < 20 && cursor; i++) {
      if (cursor === userId) throw new BadRequestException('不能互相绑定推荐关系');
      const next = await this.prisma.user.findUnique({
        where: { id: cursor },
        select: { inviterId: true },
      });
      cursor = next?.inviterId ?? null;
    }
    const bound = await this.prisma.user.updateMany({
      where: { id: userId, inviterId: null },
      data: { inviterId: inviter.id },
    });
    if (!bound.count) throw new BadRequestException('已绑定过推荐人');
    return { bound: true, inviter: inviter.nickname };
  }

  /** 推广中心数据：我的邀请码 + 下线 + 佣金记录 */
  @Get('referral')
  async referral(@CurrentUser() userId: string) {
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.inviteCode) {
      // 懒生成邀请码（6 位字母数字），碰撞时重试
      for (let i = 0; i < 3 && !user.inviteCode; i++) {
        const code = 'DP' + Math.random().toString(36).slice(2, 8).toUpperCase();
        try {
          user = await this.prisma.user.update({ where: { id: userId }, data: { inviteCode: code } });
        } catch {
          user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        }
      }
    }
    const [invitees, commissions, rateSetting, inviter] = await Promise.all([
      this.prisma.user.findMany({
        where: { inviterId: userId },
        select: { id: true, nickname: true, avatar: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.commission.findMany({
        where: { inviterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.setting.findUnique({ where: { key: 'commissionRate' } }),
      user.inviterId
        ? this.prisma.user.findUnique({ where: { id: user.inviterId }, select: { nickname: true } })
        : null,
    ]);
    // 佣金记录关联下线昵称与订单号
    const inviteeIds = [...new Set(commissions.map((c) => c.inviteeId))];
    const inviteeUsers = await this.prisma.user.findMany({
      where: { id: { in: inviteeIds } },
      select: { id: true, nickname: true },
    });
    const orders = await this.prisma.order.findMany({
      where: { id: { in: commissions.map((c) => c.orderId) } },
      select: { id: true, orderNo: true, totalAmount: true },
    });
    const nameOf = new Map(inviteeUsers.map((u) => [u.id, u.nickname]));
    const orderOf = new Map(orders.map((o) => [o.id, o]));
    const totalAgg = await this.prisma.commission.aggregate({
      where: { inviterId: userId },
      _sum: { amount: true },
    });
    return {
      inviteCode: user.inviteCode,
      inviterNickname: inviter?.nickname ?? null,
      rate: Number(rateSetting?.value ?? 5) / 100,
      inviteeCount: invitees.length,
      totalCommission: Number(totalAgg._sum.amount ?? 0),
      invitees: invitees.slice(0, 20),
      commissions: commissions.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        rate: c.rate,
        createdAt: c.createdAt,
        inviteeNickname: nameOf.get(c.inviteeId) ?? '用户',
        orderNo: orderOf.get(c.orderId)?.orderNo ?? '',
        orderAmount: Number(orderOf.get(c.orderId)?.totalAmount ?? 0),
      })),
    };
  }

  /** 模拟充值（演示/测试用途，生产环境关闭——真实充值应走支付渠道回调） */
  @Post('recharge')
  async recharge(@CurrentUser() userId: string, @Body() dto: RechargeDto) {
    if (IS_PROD) throw new BadRequestException('演示充值未开启');
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: dto.amount } },
      });
      await logBalance(tx, { userId, type: 'recharge', amount: dto.amount, remark: '模拟充值' });
      return u;
    });
    return { balance: Number(user.balance) };
  }

  /** 充值卡核销：占用与入账同一事务，条件更新防重复使用；连续错误频限防爆破 */
  @Post('redeem')
  async redeem(@CurrentUser() userId: string, @Body() dto: RedeemDto) {
    const now = Date.now();
    const rec = redeemFails.get(userId);
    if (rec && rec.count >= 10 && now < rec.resetAt) {
      throw new BadRequestException('尝试次数过多，请10分钟后再试');
    }
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('请输入卡密');
    const card = await this.prisma.rechargeCard.findUnique({ where: { code } });
    if (!card) {
      if (!rec || now >= rec.resetAt) redeemFails.set(userId, { count: 1, resetAt: now + 10 * 60 * 1000 });
      else rec.count += 1;
      throw new BadRequestException('卡密无效');
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.rechargeCard.updateMany({
        where: { code, usedById: null },
        data: { usedById: userId, usedAt: new Date() },
      });
      if (claim.count === 0) throw new BadRequestException('该卡已被使用');
      const u = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: card.amount } },
      });
      await logBalance(tx, { userId, type: 'card', amount: Number(card.amount), refId: card.id, remark: `充值卡 ${card.code}` });
      return u;
    });
    redeemFails.delete(userId);
    return { balance: Number(user.balance), amount: Number(card.amount) };
  }

  /** 钱包：余额 + 收支流水分页 */
  @Get('wallet')
  async wallet(@CurrentUser() userId: string, @Query('page') page?: string) {
    const p = Math.max(1, Number(page) || 1);
    const size = 20;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [total, items] = await this.prisma.$transaction([
      this.prisma.balanceLog.count({ where: { userId } }),
      this.prisma.balanceLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
      }),
    ]);
    return {
      balance: Number(user.balance),
      total,
      items: items.map((l) => ({
        id: l.id, type: l.type, amount: Number(l.amount), remark: l.remark, createdAt: l.createdAt,
      })),
    };
  }

  @Put('profile')
  async update(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    if (dto.nickname !== undefined) {
      dto.nickname = dto.nickname.trim();
      if (!dto.nickname) throw new BadRequestException('昵称不能为空');
      assertClean(dto.nickname, '昵称');
    }
    if (dto.city) assertClean(dto.city, '城市');
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      include: { partner: { select: { id: true } } },
    });
    return { ...this.auth.toProfile(user), partnerId: user.partner?.id ?? null };
  }

  @Get('follows')
  async follows(@CurrentUser() userId: string) {
    const rows = await this.prisma.follow.findMany({
      where: {
        userId,
        partner: { auditStatus: 'approved', user: { disabled: false } },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        partner: {
          include: {
            user: { select: { nickname: true, avatar: true, gender: true, disabled: true } },
            _count: { select: { follows: true } },
          },
        },
      },
    });
    return rows.map((f) => ({
      id: f.partner.id,
      nickname: f.partner.user.nickname,
      avatar: f.partner.user.avatar,
      gender: f.partner.user.gender,
      city: f.partner.city,
      district: f.partner.district,
      tags: JSON.parse(f.partner.tags) as string[],
      status: f.partner.status,
      verified: f.partner.verified,
      recommended: f.partner.recommended,
      rating: f.partner.rating,
      serviceCount: f.partner.serviceCount,
      cover: (JSON.parse(f.partner.photos) as string[])[0] ?? null,
      age: f.partner.age,
      followerCount: f.partner._count.follows,
      distance: null,
      followed: true,
    }));
  }
}
