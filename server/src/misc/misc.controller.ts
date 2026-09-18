import {
  BadRequestException,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { CurrentUser, JwtAuthGuard, OptionalAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

@Controller()
export class MiscController {
  constructor(private prisma: PrismaService) {}

  @Get('home')
  @UseGuards(OptionalAuthGuard)
  async home(@CurrentUser() userId?: string) {
    const [banners, recommend, newest] = await this.prisma.$transaction([
      this.prisma.banner.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.partner.findMany({
        where: { auditStatus: 'approved' },
        orderBy: [{ rating: 'desc' }, { serviceCount: 'desc' }],
        take: 6,
        include: { user: { select: { nickname: true, avatar: true, gender: true } } },
      }),
      this.prisma.partner.findMany({
        where: { auditStatus: 'approved' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { user: { select: { nickname: true, avatar: true, gender: true } } },
      }),
    ]);

    let followed = new Set<string>();
    if (userId) {
      const fs = await this.prisma.follow.findMany({ where: { userId }, select: { partnerId: true } });
      followed = new Set(fs.map((f) => f.partnerId));
    }

    const card = (p: (typeof recommend)[number]) => ({
      id: p.id,
      nickname: p.user.nickname,
      avatar: p.user.avatar,
      gender: p.user.gender,
      city: p.city,
      district: p.district,
      tags: JSON.parse(p.tags) as string[],
      status: p.status,
      verified: p.verified,
      rating: p.rating,
      serviceCount: p.serviceCount,
      cover: (JSON.parse(p.photos) as string[])[0] ?? null,
      followed: followed.has(p.id),
    });

    return {
      banners: banners.map((b) => ({ id: b.id, image: b.image, link: b.link })),
      recommend: recommend.map(card),
      newest: newest.map(card),
      cities: ['上海', '北京', '杭州', '成都', '广州', '深圳'],
    };
  }

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(@UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    if (!file) throw new BadRequestException('缺少文件');
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) throw new BadRequestException('不支持的文件类型');
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    writeFileSync(join(UPLOAD_DIR, name), file.buffer);
    return { url: `/uploads/${name}` };
  }
}
