import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

async function resolveUser(req: Request, jwt: JwtService): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = await jwt.verifyAsync<{ sub: string }>(header.slice(7));
    return payload.sub;
  } catch {
    return null;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const userId = await resolveUser(req, this.jwt);
    if (!userId) throw new UnauthorizedException('请先登录');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { disabled: true },
    });
    if (!user || user.disabled) throw new UnauthorizedException('账号已被禁用');
    req.userId = userId;
    return true;
  }
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const userId = await resolveUser(req, this.jwt);
    if (userId) {
      // 禁用账号按匿名处理，不注入身份
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { disabled: true },
      });
      if (user && !user.disabled) req.userId = userId;
    }
    return true;
  }
}

/** 管理员守卫：须在 JwtAuthGuard 之后使用 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    if (!req.userId) throw new UnauthorizedException('请先登录');
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, disabled: true },
    });
    if (user?.role !== 'admin' || user.disabled) {
      throw new ForbiddenException('需要管理员权限');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ userId?: string }>().userId,
);
