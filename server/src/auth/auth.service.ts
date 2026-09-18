import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';

const SMS_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async sendSms(mobile: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.smsCode.create({
      data: {
        mobile,
        code,
        expiresAt: new Date(Date.now() + SMS_TTL_MS),
      },
    });
    // 开发环境没有真实短信通道，直接回显验证码
    return { devCode: code };
  }

  async login(mobile: string, code: string, inviteCode?: string) {
    // 演示万能码：DEMO_UNIVERSAL_CODE=false 关闭，生产必须关闭
    const demoCode = process.env.DEMO_UNIVERSAL_CODE ?? '888888';
    const isDemoCode = demoCode !== 'false' && code === demoCode;
    if (!isDemoCode) {
      const record = await this.prisma.smsCode.findFirst({
        where: { mobile, code, used: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!record) throw new UnauthorizedException('验证码错误或已过期');
      await this.prisma.smsCode.update({ where: { id: record.id }, data: { used: true } });
    }

    let user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user) {
      // 新用户注册时可携带邀请码绑定推荐关系
      let inviterId: string | undefined;
      if (inviteCode) {
        const inviter = await this.prisma.user.findUnique({ where: { inviteCode } });
        if (inviter) inviterId = inviter.id;
      }
      user = await this.prisma.user.create({
        data: { mobile, nickname: `用户${mobile.slice(-4)}`, inviterId },
      });
    }
    if (user.disabled) throw new UnauthorizedException('账号已被禁用，请联系客服');
    return {
      token: await this.jwt.signAsync({ sub: user.id }),
      user: this.toProfile(user),
    };
  }

  toProfile(user: {
    id: string;
    mobile: string;
    nickname: string;
    avatar: string | null;
    gender: string | null;
    city: string | null;
    balance: unknown;
    role?: string;
  }) {
    return {
      id: user.id,
      mobile: user.mobile,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      city: user.city,
      balance: Number(user.balance),
      role: user.role ?? 'user',
    };
  }
}
