import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

class ServiceItemDto {
  @IsString()
  @MaxLength(30)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  desc?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @MaxLength(5)
  unit: string;

  @IsInt()
  @Min(1)
  @Max(99)
  miniNum: number;
}

class ApplyDto {
  @IsString()
  @MaxLength(20)
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  photos?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services: ServiceItemDto[];
}

class UpdateProfileDto extends ApplyDto {}

class StatusDto {
  @IsIn(['available', 'rest'])
  status: 'available' | 'rest';
}

@Controller('partner')
@UseGuards(JwtAuthGuard)
export class PartnerSelfController {
  constructor(private prisma: PrismaService) {}

  /** 申请成为玩伴（提交后待平台审核） */
  @Post('apply')
  async apply(@CurrentUser() userId: string, @Body() dto: ApplyDto) {
    const exists = await this.prisma.partner.findUnique({ where: { userId } });
    if (exists) throw new BadRequestException('你已是玩伴');
    const partner = await this.prisma.partner.create({
      data: {
        userId,
        city: dto.city,
        district: dto.district,
        bio: dto.bio,
        tags: JSON.stringify(dto.tags ?? []),
        photos: JSON.stringify(dto.photos ?? []),
        services: {
          create: dto.services.map((s, i) => ({
            name: s.name,
            desc: s.desc,
            price: s.price,
            unit: s.unit,
            miniNum: s.miniNum,
            sort: i,
          })),
        },
      },
    });
    return { id: partner.id };
  }

  @Get('profile')
  async profile(@CurrentUser() userId: string) {
    const p = await this.mustBePartner(userId);
    const full = await this.prisma.partner.findUniqueOrThrow({
      where: { id: p.id },
      include: { services: { orderBy: { sort: 'asc' } } },
    });
    return {
      id: full.id,
      city: full.city,
      district: full.district,
      bio: full.bio,
      tags: JSON.parse(full.tags) as string[],
      photos: JSON.parse(full.photos) as string[],
      status: full.status,
      auditStatus: full.auditStatus,
      rating: full.rating,
      serviceCount: full.serviceCount,
      viewCount: full.viewCount,
      services: full.services.map((s) => ({
        id: s.id,
        name: s.name,
        desc: s.desc,
        price: Number(s.price),
        unit: s.unit,
        miniNum: s.miniNum,
      })),
    };
  }

  @Put('profile')
  async update(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    const p = await this.mustBePartner(userId);
    await this.prisma.partnerService.deleteMany({ where: { partnerId: p.id } });
    await this.prisma.partner.update({
      where: { id: p.id },
      data: {
        city: dto.city,
        district: dto.district,
        bio: dto.bio,
        tags: JSON.stringify(dto.tags ?? []),
        photos: JSON.stringify(dto.photos ?? []),
        services: {
          create: dto.services.map((s, i) => ({
            name: s.name,
            desc: s.desc,
            price: s.price,
            unit: s.unit,
            miniNum: s.miniNum,
            sort: i,
          })),
        },
      },
    });
    return this.profile(userId);
  }

  @Put('status')
  async setStatus(@CurrentUser() userId: string, @Body() dto: StatusDto) {
    const p = await this.mustBePartner(userId);
    await this.prisma.partner.update({ where: { id: p.id }, data: { status: dto.status } });
    return { status: dto.status };
  }

  @Get('stats')
  async stats(@CurrentUser() userId: string) {
    const p = await this.mustBePartner(userId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [pending, todayOrders, doneAgg, followers] = await this.prisma.$transaction([
      this.prisma.order.count({ where: { partnerId: p.id, status: 'pending_accept' } }),
      this.prisma.order.count({ where: { partnerId: p.id, createdAt: { gte: today } } }),
      this.prisma.order.aggregate({
        where: { partnerId: p.id, status: 'done' },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.follow.count({ where: { partnerId: p.id } }),
    ]);
    return {
      pendingAccept: pending,
      todayOrders,
      doneCount: doneAgg._count,
      doneAmount: Number(doneAgg._sum.totalAmount ?? 0),
      followers,
      rating: p.rating,
      status: p.status,
      auditStatus: p.auditStatus,
    };
  }

  /** 我收到的评价 */
  @Get('reviews')
  async reviews(@CurrentUser() userId: string) {
    const p = await this.mustBePartner(userId);
    const rows = await this.prisma.review.findMany({
      where: { partnerId: p.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { nickname: true, avatar: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      content: r.content,
      reply: r.reply,
      replyAt: r.replyAt,
      createdAt: r.createdAt,
      user: r.user,
    }));
  }

  /** 回复评价 */
  @Post('reviews/:id/reply')
  async replyReview(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: { content: string }) {
    const p = await this.mustBePartner(userId);
    const r = await this.prisma.review.findUnique({ where: { id } });
    if (!r || r.partnerId !== p.id) throw new BadRequestException('评价不存在');
    if (r.reply) throw new BadRequestException('已回复过该评价');
    const content = (dto.content ?? '').trim();
    if (!content) throw new BadRequestException('回复内容不能为空');
    await this.prisma.review.update({
      where: { id },
      data: { reply: content.slice(0, 300), replyAt: new Date() },
    });
    return { ok: true };
  }

  /** 钱包：余额 + 提现记录 */
  @Get('wallet')
  async wallet(@CurrentUser() userId: string) {
    const p = await this.mustBePartner(userId);
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { partnerId: p.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      balance: Number(p.balance),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        amount: Number(w.amount),
        status: w.status,
        remark: w.remark,
        createdAt: w.createdAt,
      })),
    };
  }

  /** 申请提现（先扣余额，拒绝退回） */
  @Post('withdraw')
  async withdraw(@CurrentUser() userId: string, @Body() dto: { amount: number }) {
    const p = await this.mustBePartner(userId);
    const amount = Math.round(Number(dto.amount) * 100) / 100;
    if (!amount || amount <= 0) throw new BadRequestException('金额无效');
    if (amount > Number(p.balance)) throw new BadRequestException('余额不足');
    const pending = await this.prisma.withdrawal.count({
      where: { partnerId: p.id, status: 'pending' },
    });
    if (pending) throw new BadRequestException('有提现申请处理中，请等待审核');
    const [, w] = await this.prisma.$transaction([
      this.prisma.partner.update({
        where: { id: p.id },
        data: { balance: { decrement: amount } },
      }),
      this.prisma.withdrawal.create({ data: { partnerId: p.id, amount } }),
    ]);
    return { id: w.id, status: w.status };
  }

  private async mustBePartner(userId: string) {
    const p = await this.prisma.partner.findUnique({ where: { userId } });
    if (!p) throw new ForbiddenException('你不是玩伴，请先申请入驻');
    return p;
  }
}
