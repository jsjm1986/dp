import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { toNum } from '../common/params.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private prisma: PrismaService) {}

  /** 领券中心：可领取的券模板 */
  @Get('claimable')
  async claimable(@CurrentUser() uid: string) {
    const now = new Date();
    const [templates, mine] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({ where: { expiresAt: { gt: now } }, orderBy: { amount: 'desc' } }),
      this.prisma.userCoupon.findMany({ where: { userId: uid }, select: { couponId: true } }),
    ]);
    const owned = new Set(mine.map((m) => m.couponId));
    return templates.map((c) => ({
      id: c.id,
      title: c.title,
      amount: Number(c.amount),
      minSpend: Number(c.minSpend),
      expiresAt: c.expiresAt,
      left: c.total < 0 ? -1 : c.total - c.claimed,
      claimed: owned.has(c.id),
    }));
  }

  /** 领券：事务内复查余量与重复领取，防并发超发 */
  @Post(':id/claim')
  async claim(@CurrentUser() uid: string, @Param('id') id: string) {
    const uc = await this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUnique({ where: { id } });
      if (!coupon) throw new NotFoundException('券不存在');
      if (coupon.expiresAt < new Date()) throw new BadRequestException('券已过期');
      if (coupon.total >= 0 && coupon.claimed >= coupon.total) throw new BadRequestException('已领完');
      const exists = await tx.userCoupon.findUnique({
        where: { userId_couponId: { userId: uid, couponId: id } },
      });
      if (exists) throw new BadRequestException('你已领过这张券');
      await tx.coupon.update({ where: { id }, data: { claimed: { increment: 1 } } });
      return tx.userCoupon.create({ data: { userId: uid, couponId: id } });
    });
    return { id: uc.id };
  }

  /** 我的券；带 amount 参数时返回该金额下是否可用 */
  @Get('mine')
  async mine(@CurrentUser() uid: string, @Query('amount') amount?: string) {
    const total = toNum(amount) ?? null;
    const rows = await this.prisma.userCoupon.findMany({
      where: { userId: uid },
      include: { coupon: true },
      orderBy: { claimedAt: 'desc' },
    });
    const now = new Date();
    return rows.map((uc) => {
      const expired = uc.coupon.expiresAt < now;
      const underMin = total !== null && total < Number(uc.coupon.minSpend);
      return {
        id: uc.id,
        title: uc.coupon.title,
        amount: Number(uc.coupon.amount),
        minSpend: Number(uc.coupon.minSpend),
        expiresAt: uc.coupon.expiresAt,
        used: uc.used,
        expired,
        usable: !uc.used && !expired && !underMin,
      };
    });
  }
}
