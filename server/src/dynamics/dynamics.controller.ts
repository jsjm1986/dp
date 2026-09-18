import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, JwtAuthGuard, OptionalAuthGuard } from '../auth/jwt-auth.guard.js';
import { assertClean } from '../common/sensitive.js';
import { PrismaService } from '../prisma/prisma.service.js';

class CreateDynamicDto {
  @IsString()
  @MaxLength(1000)
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(30)
  city?: string;
}

class CommentDto {
  @IsString()
  @MaxLength(300)
  content: string;
}

@Controller('dynamics')
export class DynamicsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  async feed(
    @CurrentUser() userId: string | undefined,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('tab') tab?: string,
  ) {
    const p = Math.max(1, page ? Number(page) : 1);
    const size = Math.min(50, pageSize ? Number(pageSize) : 10);

    // 关注流：仅看我关注的玩伴/自己的动态
    const where: any = {};
    if (tab === 'follow' && userId) {
      const follows = await this.prisma.follow.findMany({
        where: { userId },
        include: { partner: { select: { userId: true } } },
      });
      const authorIds = [...follows.map((f) => f.partner.userId), userId];
      where.userId = { in: authorIds };
    }
    // 拉黑过滤：不看自己拉黑的人、也不看拉黑自己的人的动态
    if (userId) {
      const blocks = await this.prisma.block.findMany({
        where: { OR: [{ userId }, { blockedId: userId }] },
      });
      const blocked = new Set(blocks.map((b) => (b.userId === userId ? b.blockedId : b.userId)));
      if (blocked.size) where.userId = { ...(where.userId ?? {}), notIn: [...blocked] };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dynamic.count({ where }),
      this.prisma.dynamic.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * size,
        take: size,
        include: {
          user: {
            select: { nickname: true, avatar: true, partner: { select: { id: true } } },
          },
          likes: { select: { userId: true } },
        },
      }),
    ]);
    return {
      total,
      page: p,
      pageSize: size,
      items: rows.map((d) => ({
        id: d.id,
        content: d.content,
        images: JSON.parse(d.images) as string[],
        city: d.city,
        likeCount: d.likeCount,
        commentCount: d.commentCount,
        createdAt: d.createdAt,
        liked: userId ? d.likes.some((l) => l.userId === userId) : false,
        author: {
          nickname: d.user.nickname,
          avatar: d.user.avatar,
          partnerId: d.user.partner?.id ?? null,
        },
      })),
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() userId: string, @Body() dto: CreateDynamicDto) {
    assertClean(dto.content);
    const d = await this.prisma.dynamic.create({
      data: { userId, content: dto.content, images: JSON.stringify(dto.images ?? []), city: dto.city },
    });
    return { id: d.id };
  }

  /** 我的动态 */
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async mine(@CurrentUser() userId: string) {
    const rows = await this.prisma.dynamic.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((d) => ({
      id: d.id,
      content: d.content,
      images: JSON.parse(d.images) as string[],
      city: d.city,
      likeCount: d.likeCount,
      commentCount: d.commentCount,
      createdAt: d.createdAt,
    }));
  }

  /** 删除自己的动态（管理员走 /admin/dynamics） */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@CurrentUser() userId: string, @Param('id') id: string) {
    const d = await this.prisma.dynamic.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('动态不存在');
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (d.userId !== userId && me?.role !== 'admin') throw new ForbiddenException('只能删除自己的动态');
    await this.prisma.dynamic.delete({ where: { id } });
    return { ok: true };
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  async like(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.prisma.dynamicLike.upsert({
      where: { dynamicId_userId: { dynamicId: id, userId } },
      create: { dynamicId: id, userId },
      update: {},
    });
    const likeCount = await this.prisma.dynamicLike.count({ where: { dynamicId: id } });
    await this.prisma.dynamic.update({ where: { id }, data: { likeCount } });
    return { liked: true, likeCount };
  }

  @Delete(':id/like')
  @UseGuards(JwtAuthGuard)
  async unlike(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.prisma.dynamicLike.deleteMany({ where: { dynamicId: id, userId } });
    const likeCount = await this.prisma.dynamicLike.count({ where: { dynamicId: id } });
    await this.prisma.dynamic.update({ where: { id }, data: { likeCount } });
    return { liked: false, likeCount };
  }

  @Get(':id/comments')
  async comments(@Param('id') id: string) {
    const rows = await this.prisma.dynamicComment.findMany({
      where: { dynamicId: id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { nickname: true, avatar: true } } },
      take: 100,
    });
    return rows.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      user: c.user,
    }));
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  async comment(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: CommentDto) {
    assertClean(dto.content, '评论');
    const c = await this.prisma.dynamicComment.create({
      data: { dynamicId: id, userId, content: dto.content },
      include: { user: { select: { nickname: true, avatar: true } } },
    });
    const commentCount = await this.prisma.dynamicComment.count({ where: { dynamicId: id } });
    await this.prisma.dynamic.update({ where: { id }, data: { commentCount } });
    return { id: c.id, content: c.content, createdAt: c.createdAt, user: c.user, commentCount };
  }
}
