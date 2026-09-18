import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard, OptionalAuthGuard } from './jwt-auth.guard.js';

const IS_PROD = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || jwtSecret === 'dev-secret-change-me')) {
  throw new Error('生产环境必须配置长度≥32的随机 JWT_SECRET');
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: IS_PROD ? '7d' : '30d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, OptionalAuthGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
