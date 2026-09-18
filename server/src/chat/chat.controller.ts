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
import { assertClean } from '../common/sensitive.js';
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

  /** 会话列表：按对方分组，取最新消息 + 未读数；过滤拉黑/禁用对端，限量取数 */
  @Get('conversations')
  async conversations(@CurrentUser('id') uid: string) {
    const [msgs, blocks] = await Promise.all([
      this.prisma.message.findMany({
        where: { OR: [{ senderId: uid }, { receiverId: uid }] },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        include: {
          sender: { select: { ...userBrief, disabled: true } },
          receiver: { select: { ...userBrief, disabled: true } },
        },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ userId: uid }, { blockedId: uid }] },
        select: { userId: true, blockedId: true },
      }),
    ]);
    const blocked = new Set(blocks.map((b) => (b.userId === uid ? b.blockedId : b.userId)));
    const map = new Map<string, any>();
    for (const m of msgs) {
      const peer = m.senderId === uid ? m.receiver : m.sender;
      if (blocked.has(peer.id) || peer.disabled) continue;
      if (!map.has(peer.id)) {
        map.set(peer.id, {
          peer: { id: peer.id, nickname: peer.nickname, avatar: peer.avatar },
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
    if (before) {
      const t = new Date(before);
      if (Number.isNaN(t.getTime())) throw new BadRequestException('before 格式无效');
      where.createdAt = { lt: t };
    }
    // 标记已读的边界取读取时刻之前，避免读/写竞态把新到的消息误标
    const readBound = new Date();
    const [items, peer] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(+limit || 30, 1), 100),
      }),
      this.prisma.user.findUnique({ where: { id: peerId }, select: userBrief }),
    ]);
    if (!peer) throw new NotFoundException('用户不存在');
    await this.prisma.message.updateMany({
      where: { senderId: peerId, receiverId: uid, readAt: null, createdAt: { lte: readBound } },
      data: { readAt: new Date() },
    });
    return { peer, items: items.reverse() };
  }

  /** 发消息 */
  @Post('send')
  async send(@CurrentUser('id') uid: string, @Body() dto: SendMessageDto) {
    if (dto.peerId === uid) throw new BadRequestException('不能和自己聊天');
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('消息内容不能为空');
    const peer = await this.prisma.user.findUnique({ where: { id: dto.peerId } });
    if (!peer) throw new NotFoundException('对方用户不存在');
    if (peer.disabled) throw new BadRequestException('对方账号不可用');
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { userId: uid, blockedId: dto.peerId },
          { userId: dto.peerId, blockedId: uid },
        ],
      },
    });
    if (blocked) throw new BadRequestException('消息发送失败，对方无法接收');
    assertClean(content, '消息');
    // 订单关联校验：订单须真实存在且会话双方恰为该单的买家与玩伴
    let orderId: string | null = null;
    if (dto.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        include: { partner: { select: { userId: true } } },
      });
      const pair = order ? new Set([order.userId, order.partner.userId]) : null;
      if (!order || !pair?.has(uid) || !pair.has(dto.peerId)) {
        throw new BadRequestException('关联订单无效');
      }
      orderId = order.id;
    }
    const msg = await this.prisma.message.create({
      data: {
        senderId: uid,
        receiverId: dto.peerId,
        content,
        orderId,
      },
    });
    return msg;
  }

  /** 总未读数（角标）；不统计我拉黑的人发来的消息 */
  @Get('unread')
  async unread(@CurrentUser('id') uid: string) {
    const blocks = await this.prisma.block.findMany({
      where: { userId: uid },
      select: { blockedId: true },
    });
    const count = await this.prisma.message.count({
      where: {
        receiverId: uid,
        readAt: null,
        ...(blocks.length ? { senderId: { notIn: blocks.map((b) => b.blockedId) } } : {}),
      },
    });
    return { count };
  }
}
