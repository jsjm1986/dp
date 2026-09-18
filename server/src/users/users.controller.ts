import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nickname?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  city?: string;
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

  /** 客服账号（第一个管理员） */
  @Get('service')
  async service() {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, nickname: true, avatar: true },
    });
    return admin;
  }

  /** 绑定推荐人（只能绑一次，不能绑自己） */
  @Post('bind-inviter')
  async bindInviter(@CurrentUser() userId: string, @Body() dto: { code: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.inviterId) throw new BadRequestException('已绑定过推荐人');
    const inviter = await this.prisma.user.findUnique({
      where: { inviteCode: (dto.code ?? '').trim().toUpperCase() },
    });
    if (!inviter) throw new BadRequestException('邀请码不存在');
    if (inviter.id === userId) throw new BadRequestException('不能绑定自己');
    await this.prisma.user.update({ where: { id: userId }, data: { inviterId: inviter.id } });
    return { bound: true, inviter: inviter.nickname };
  }

  /** 推广中心数据：我的邀请码 + 下线 + 佣金记录 */
  @Get('referral')
  async referral(@CurrentUser() userId: string) {
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.inviteCode) {
      // 懒生成邀请码（6 位字母数字）
      const code = 'DP' + Math.random().toString(36).slice(2, 8).toUpperCase();
      try {
        user = await this.prisma.user.update({ where: { id: userId }, data: { inviteCode: code } });
      } catch {
        user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
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
    return {
      inviteCode: user.inviteCode,
      inviterNickname: inviter?.nickname ?? null,
      rate: Number(rateSetting?.value ?? 5) / 100,
      inviteeCount: invitees.length,
      totalCommission: commissions.reduce((s, c) => s + Number(c.amount), 0),
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

  /** 模拟充值 */
  @Post('recharge')
  async recharge(@CurrentUser() userId: string, @Body() dto: { amount: number }) {
    const amount = Math.min(Math.max(Number(dto.amount) || 0, 1), 10000);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } },
    });
    return { balance: Number(user.balance) };
  }

  @Put('profile')
  async update(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return this.auth.toProfile(user);
  }

  @Get('follows')
  async follows(@CurrentUser() userId: string) {
    const rows = await this.prisma.follow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        partner: {
          include: {
            user: { select: { nickname: true, avatar: true, gender: true } },
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
