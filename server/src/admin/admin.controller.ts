import {
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
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AdminGuard, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
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

const userBrief = { id: true, mobile: true, nickname: true, avatar: true, city: true, role: true, createdAt: true } as const;

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
  async orders(@Query('page') page = '1', @Query('status') status?: string) {
    const where: any = status ? { status } : {};
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
}
