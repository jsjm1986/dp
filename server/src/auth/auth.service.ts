import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'crypto';
import { Prisma } from '../generated/prisma/client.js';
import { checkRate } from '../common/rate.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SMS_TTL_MS = 5 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';
// 登录失败频限：同手机号 10 分钟内最多错 10 次（内存实现，重启清零）
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginFails = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async sendSms(mobile: string) {
    // 60s 内重复发码复用未过期验证码，防刷码/爆破；同号每日上限 10 条（接真实短信后的资费保护）
    if (!checkRate(`sms:${mobile}`, 10, 24 * 3600_000)) {
      throw new BadRequestException('今日验证码获取次数已达上限');
    }
    const recent = await this.prisma.smsCode.findFirst({
      where: { mobile, used: false, expiresAt: { gt: new Date() }, createdAt: { gt: new Date(Date.now() - 60_000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return IS_PROD ? { ok: true } : { devCode: recent.code };
    // CSPRNG 验证码
    const code = String(randomInt(100000, 1000000));
    // 作废旧验证码，防止多码并存爆破
    await this.prisma.$transaction([
      this.prisma.smsCode.updateMany({ where: { mobile, used: false }, data: { used: true } }),
      this.prisma.smsCode.create({
        data: { mobile, code, expiresAt: new Date(Date.now() + SMS_TTL_MS) },
      }),
    ]);
    // 仅非生产环境回显验证码（无真实短信通道的演示用途）
    return IS_PROD ? { ok: true } : { devCode: code };
  }

  async login(mobile: string, code: string, inviteCode?: string) {
    // 演示万能码：DEMO_UNIVERSAL_CODE=false 关闭；生产环境强制关闭
    const demoCode = IS_PROD ? 'false' : (process.env.DEMO_UNIVERSAL_CODE ?? '888888');
    const isDemoCode = demoCode !== 'false' && code === demoCode;
    if (!isDemoCode) {
      this.checkLoginThrottle(mobile);
      const record = await this.prisma.smsCode.findFirst({
        where: { mobile, code, used: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!record) {
        this.recordLoginFail(mobile);
        throw new UnauthorizedException('验证码错误或已过期');
      }
      loginFails.delete(mobile);
      await this.prisma.smsCode.update({ where: { id: record.id }, data: { used: true } });
    }

    let user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user) {
      // 新用户注册时可携带邀请码绑定推荐关系（归一化为大写；推荐人需未禁用）
      let inviterId: string | undefined;
      if (inviteCode) {
        const inviter = await this.prisma.user.findUnique({
          where: { inviteCode: inviteCode.trim().toUpperCase() },
        });
        if (inviter && !inviter.disabled) inviterId = inviter.id;
      }
      try {
        user = await this.prisma.user.create({
          data: { mobile, nickname: `用户${mobile.slice(-4)}`, inviterId },
        });
      } catch (e) {
        // 并发首登撞 mobile 唯一约束：重查后继续登录
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          user = await this.prisma.user.findUniqueOrThrow({ where: { mobile } });
        } else throw e;
      }
    }
    if (user.disabled) throw new UnauthorizedException('账号已被禁用，请联系客服');
    const partner = await this.prisma.partner.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    return {
      token: await this.jwt.signAsync({ sub: user.id }),
      user: { ...this.toProfile(user), partnerId: partner?.id ?? null },
    };
  }

  private checkLoginThrottle(mobile: string) {
    const rec = loginFails.get(mobile);
    if (rec && rec.count >= LOGIN_MAX_FAILS && Date.now() < rec.resetAt) {
      throw new UnauthorizedException('尝试次数过多，请10分钟后再试');
    }
  }

  private recordLoginFail(mobile: string) {
    const now = Date.now();
    const rec = loginFails.get(mobile);
    if (!rec || now >= rec.resetAt) {
      loginFails.set(mobile, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      rec.count += 1;
    }
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
