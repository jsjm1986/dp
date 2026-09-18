import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
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

  /** 客服账号（第一个管理员） */
  @Get('service')
  async service() {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, nickname: true, avatar: true },
    });
    return admin;
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
