import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { bjDateKey, bjDayStart, orderHours } from '../common/ledger.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PartnerQuery {
  city?: string;
  keyword?: string;
  sort?: 'default' | 'newest' | 'rating' | 'distance';
  lat?: number;
  lng?: number;
  page?: number;
  pageSize?: number;
}

const CARD_SELECT = {
  id: true,
  city: true,
  district: true,
  tags: true,
  status: true,
  verified: true,
  recommended: true,
  serviceCount: true,
  rating: true,
  photos: true,
  age: true,
  latitude: true,
  longitude: true,
  user: { select: { nickname: true, avatar: true, gender: true } },
  _count: { select: { follows: true } },
} satisfies Prisma.PartnerSelect;

@Injectable()
export class PartnersService {
  constructor(private prisma: PrismaService) {}

  async list(q: PartnerQuery, viewerId?: string) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(50, q.pageSize ?? 10);

    const where: Prisma.PartnerWhereInput = {
      auditStatus: 'approved',
      user: { is: { disabled: false } },
    };
    if (q.city) where.city = { contains: q.city };
    if (q.keyword) {
      where.OR = [
        { user: { nickname: { contains: q.keyword } } },
        { tags: { contains: q.keyword } },
      ];
    }

    const orderBy: Prisma.PartnerOrderByWithRelationInput[] =
      q.sort === 'newest'
        ? [{ recommended: 'desc' }, { createdAt: 'desc' }]
        : q.sort === 'rating'
          ? [{ recommended: 'desc' }, { rating: 'desc' }, { serviceCount: 'desc' }]
          : [{ recommended: 'desc' }, { rating: 'desc' }, { serviceCount: 'desc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.partner.count({ where }),
      this.prisma.partner.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: CARD_SELECT,
      }),
    ]);

    let items = rows.map((p) => this.toCard(p, q.lat, q.lng));
    if (q.sort === 'distance' && q.lat != null && q.lng != null) {
      items = items.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }

    if (viewerId && items.length) {
      const follows = await this.prisma.follow.findMany({
        where: { userId: viewerId, partnerId: { in: items.map((i) => i.id) } },
        select: { partnerId: true },
      });
      const set = new Set(follows.map((f) => f.partnerId));
      items = items.map((i) => ({ ...i, followed: set.has(i.id) }));
    }

    return { total, page, pageSize, items };
  }

  async detail(id: string, viewerId?: string) {
    const p = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        user: { select: { nickname: true, avatar: true, gender: true, disabled: true } },
        services: { orderBy: { sort: 'asc' } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { nickname: true, avatar: true } } },
        },
        _count: { select: { follows: true, reviews: true } },
      },
    });
    // 未通过审核或账号被禁用的玩伴不对外展示（本人可预览）
    if (!p || (p.userId !== viewerId && (p.auditStatus !== 'approved' || p.user.disabled))) {
      throw new NotFoundException('玩伴不存在');
    }
    // 拉黑即双向不可见
    if (viewerId && viewerId !== p.userId) {
      const blocked = await this.prisma.block.findFirst({
        where: { OR: [{ userId: viewerId, blockedId: p.userId }, { userId: p.userId, blockedId: viewerId }] },
        select: { id: true },
      });
      if (blocked) throw new NotFoundException('玩伴不存在');
    }
    // 浏览量：本人查看不计数（防自刷）
    if (p.userId !== viewerId) {
      await this.prisma.partner.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    }

    const followed = viewerId
      ? !!(await this.prisma.follow.findUnique({
          where: { userId_partnerId: { userId: viewerId, partnerId: id } },
        }))
      : false;

    return {
      id: p.id,
      userId: p.userId,
      nickname: p.user.nickname,
      avatar: p.user.avatar,
      gender: p.user.gender,
      photos: JSON.parse(p.photos) as string[],
      voiceIntro: p.voiceIntro,
      bio: p.bio,
      age: p.age,
      height: p.height,
      weight: p.weight,
      constellation: p.constellation,
      education: p.education,
      tags: JSON.parse(p.tags) as string[],
      city: p.city,
      district: p.district,
      latitude: p.latitude,
      longitude: p.longitude,
      status: p.status,
      verified: p.verified,
      serviceCount: p.serviceCount,
      viewCount: p.viewCount + 1,
      rating: p.rating,
      followerCount: p._count.follows,
      // 微信号仅登录用户可见（匿名抓取防护）
      wechatId: viewerId ? p.wechatId : null,
      followed,
      services: p.services.map((s) => ({
        id: s.id,
        name: s.name,
        desc: s.desc,
        price: Number(s.price),
        unit: s.unit,
        miniNum: s.miniNum,
      })),
      reviews: p.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        reply: r.reply,
        createdAt: r.createdAt,
        user: r.user,
      })),
      reviewCount: p._count.reviews,
      dynamics: await this.prisma.dynamic.findMany({
        where: { userId: p.userId },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }).then((ds) =>
        ds.map((d) => ({
          id: d.id,
          content: d.content,
          images: JSON.parse(d.images) as string[],
          likeCount: d.likeCount,
          commentCount: d.commentCount,
          createdAt: d.createdAt,
        })),
      ),
    };
  }

  async reviews(id: string, page = 1, pageSize = 10) {
    // 仅审核通过且未禁用的玩伴公开评价
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      select: { auditStatus: true, user: { select: { disabled: true } } },
    });
    if (!partner || partner.auditStatus !== 'approved' || partner.user.disabled) {
      throw new NotFoundException('玩伴不存在');
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count({ where: { partnerId: id } }),
      this.prisma.review.findMany({
        where: { partnerId: id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { nickname: true, avatar: true } } },
      }),
    ]);
    return { total, items: rows };
  }

  async follow(userId: string, partnerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      include: { user: { select: { disabled: true } } },
    });
    if (!partner || partner.auditStatus !== 'approved' || partner.user.disabled) {
      throw new NotFoundException('玩伴不存在');
    }
    if (partner.userId === userId) throw new BadRequestException('不能关注自己');
    // 双向拉黑不可关注
    const blocked = await this.prisma.block.findFirst({
      where: { OR: [{ userId, blockedId: partner.userId }, { userId: partner.userId, blockedId: userId }] },
      select: { id: true },
    });
    if (blocked) throw new BadRequestException('无法关注该玩伴');
    await this.prisma.follow.upsert({
      where: { userId_partnerId: { userId, partnerId } },
      create: { userId, partnerId },
      update: {},
    });
    return { followed: true };
  }

  async unfollow(userId: string, partnerId: string) {
    await this.prisma.follow.deleteMany({ where: { userId, partnerId } });
    return { followed: false };
  }

  /** 指定日期已被占用的预约小时（北京时间口径，含待支付占位；「天」服务返回 allDay） */
  async busySlots(partnerId: string, date?: string) {
    const day = date ? new Date(`${date}T00:00:00+08:00`) : new Date();
    if (Number.isNaN(day.getTime())) throw new BadRequestException('date 格式应为 YYYY-MM-DD');
    const start = bjDayStart(day);
    const dateKey = date ?? bjDateKey(new Date());
    const off = await this.prisma.partnerOffDate.findUnique({
      where: { partnerId_date: { partnerId, date: dateKey } },
    });
    if (off) return { allDay: true, hours: [] };
    const orders = await this.prisma.order.findMany({
      where: {
        partnerId,
        appointAt: { gte: start, lt: new Date(start.getTime() + 86400_000) },
        status: { in: ['pending_payment', 'pending_accept', 'pending_service', 'serving'] },
      },
      select: { appointAt: true, items: { select: { unit: true, num: true } } },
      take: 100,
    });
    const hours = new Set<number>();
    let allDay = false;
    for (const o of orders) {
      const h = orderHours(o.appointAt, o.items);
      if (h === null) { allDay = true; break; }
      h.forEach((x) => hours.add(x));
    }
    return { allDay, hours: [...hours].sort((a, b) => a - b) };
  }

  private toCard(
    p: Prisma.PartnerGetPayload<{ select: typeof CARD_SELECT }>,
    lat?: number,
    lng?: number,
  ) {
    const distance =
      lat != null && lng != null && p.latitude != null && p.longitude != null
        ? haversineKm(lat, lng, p.latitude, p.longitude)
        : null;
    return {
      id: p.id,
      nickname: p.user.nickname,
      avatar: p.user.avatar,
      gender: p.user.gender,
      city: p.city,
      district: p.district,
      tags: JSON.parse(p.tags) as string[],
      status: p.status,
      verified: p.verified,
      recommended: p.recommended,
      serviceCount: p.serviceCount,
      rating: p.rating,
      cover: (JSON.parse(p.photos) as string[])[0] ?? null,
      age: p.age,
      followerCount: p._count.follows,
      distance: distance == null ? null : Math.round(distance * 10) / 10,
      followed: false,
    };
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
