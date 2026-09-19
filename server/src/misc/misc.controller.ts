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
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { CurrentUser, JwtAuthGuard, OptionalAuthGuard } from '../auth/jwt-auth.guard.js';
import { checkRate } from '../common/rate.js';
import { PrismaService } from '../prisma/prisma.service.js';

// 以模块位置定位上传目录，不依赖启动 cwd（与 main.ts 静态目录保持一致）
const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../uploads');
// SVG 可携带脚本造成存储型 XSS（同源 /uploads 静态服务），只允许位图
const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAGIC: Array<{ ext: string[]; bytes: number[]; offset?: number }> = [
  { ext: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },
  { ext: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ['.webp'], bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
  { ext: ['.gif'], bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
];
// WEBP 还需偏移 8 处的 fourcc，否则任意 RIFF 容器（WAV/polyglot）可通过
const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50];

@Controller()
export class MiscController {
  constructor(private prisma: PrismaService) {}

  @Get('home')
  @UseGuards(OptionalAuthGuard)
  async home(@CurrentUser() userId?: string) {
    const [banners, recommend, newest, announcement] = await this.prisma.$transaction([
      this.prisma.banner.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.partner.findMany({
        where: { auditStatus: 'approved', user: { is: { disabled: false } } },
        orderBy: [{ recommended: 'desc' }, { rating: 'desc' }, { serviceCount: 'desc' }],
        take: 6,
        include: {
          user: { select: { nickname: true, avatar: true, gender: true } },
          _count: { select: { follows: true } },
        },
      }),
      this.prisma.partner.findMany({
        where: { auditStatus: 'approved', user: { is: { disabled: false } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          user: { select: { nickname: true, avatar: true, gender: true } },
          _count: { select: { follows: true } },
        },
      }),
      this.prisma.announcement.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'desc' } }),
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
      recommended: p.recommended,
      age: p.age,
      rating: p.rating,
      serviceCount: p.serviceCount,
      cover: (JSON.parse(p.photos) as string[])[0] ?? null,
      followerCount: p._count.follows,
      distance: null,
      followed: followed.has(p.id),
    });

    return {
      banners: banners.map((b) => ({ id: b.id, image: b.image, link: b.link })),
      recommend: recommend.map(card),
      newest: newest.map(card),
      cities: ['上海', '北京', '杭州', '成都', '广州', '深圳'],
      announcement: announcement ? { id: announcement.id, title: announcement.title, content: announcement.content } : null,
    };
  }

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(@CurrentUser() userId: string, @UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    if (!file) throw new BadRequestException('缺少文件');
    // 每用户上传频限，防磁盘灌满
    if (!checkRate(`upload:${userId}`, 30, 3600_000)) {
      throw new BadRequestException('上传过于频繁，请稍后再试');
    }
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) throw new BadRequestException('不支持的文件类型');
    // 魔数校验：防止改扩展名上传伪装文件
    const sig = MAGIC.find((m) => m.ext.includes(ext));
    if (sig && !sig.bytes.every((b, i) => file.buffer[i] === b)) {
      throw new BadRequestException('文件内容与类型不符');
    }
    if (ext === '.webp' && !WEBP_FOURCC.every((b, i) => file.buffer[8 + i] === b)) {
      throw new BadRequestException('文件内容与类型不符');
    }
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    writeFileSync(join(UPLOAD_DIR, name), file.buffer);
    return { url: `/uploads/${name}` };
  }
}
