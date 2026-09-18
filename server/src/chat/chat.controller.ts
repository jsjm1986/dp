import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

class SendMessageDto {
  @IsString()
  peerId: string;

  @IsString()
  @MaxLength(500)
  content: string;

  @IsOptional()
  @IsString()
  orderId?: string;
}

const userBrief = { id: true, nickname: true, avatar: true } as const;

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private prisma: PrismaService) {}

  /** 会话列表：按对方分组，取最新消息 + 未读数 */
  @Get('conversations')
  async conversations(@CurrentUser('id') uid: string) {
    const msgs = await this.prisma.message.findMany({
      where: { OR: [{ senderId: uid }, { receiverId: uid }] },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: userBrief }, receiver: { select: userBrief } },
    });
    const map = new Map<string, any>();
    for (const m of msgs) {
      const peer = m.senderId === uid ? m.receiver : m.sender;
      if (!map.has(peer.id)) {
        map.set(peer.id, {
          peer,
          lastMessage: { content: m.content, createdAt: m.createdAt, fromMe: m.senderId === uid },
          unread: 0,
        });
      }
      if (m.receiverId === uid && !m.readAt) map.get(peer.id).unread++;
    }
    return [...map.values()];
  }

  /** 与某人的消息记录（倒序分页），读取时把对方发来的标记已读 */
  @Get('messages')
  async messages(
    @CurrentUser('id') uid: string,
    @Query('peerId') peerId: string,
    @Query('before') before?: string,
    @Query('limit') limit = '30',
  ) {
    if (!peerId) throw new BadRequestException('peerId 必填');
    const where: any = {
      OR: [
        { senderId: uid, receiverId: peerId },
        { senderId: peerId, receiverId: uid },
      ],
    };
    if (before) where.createdAt = { lt: new Date(before) };
    const [items, peer] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(+limit || 30, 100),
      }),
      this.prisma.user.findUnique({ where: { id: peerId }, select: userBrief }),
    ]);
    if (!peer) throw new NotFoundException('用户不存在');
    await this.prisma.message.updateMany({
      where: { senderId: peerId, receiverId: uid, readAt: null },
      data: { readAt: new Date() },
    });
    return { peer, items: items.reverse() };
  }

  /** 发消息 */
  @Post('send')
  async send(@CurrentUser('id') uid: string, @Body() dto: SendMessageDto) {
    if (dto.peerId === uid) throw new BadRequestException('不能和自己聊天');
    const peer = await this.prisma.user.findUnique({ where: { id: dto.peerId } });
    if (!peer) throw new NotFoundException('对方用户不存在');
    const msg = await this.prisma.message.create({
      data: {
        senderId: uid,
        receiverId: dto.peerId,
        content: dto.content.trim(),
        orderId: dto.orderId || null,
      },
    });
    return msg;
  }

  /** 总未读数（角标） */
  @Get('unread')
  async unread(@CurrentUser('id') uid: string) {
    const count = await this.prisma.message.count({
      where: { receiverId: uid, readAt: null },
    });
    return { count };
  }
}
