import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'dotenv/config';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AppModule } from './app.module.js';
import { initSensitive } from './common/sensitive.js';
import { PrismaService } from './prisma/prisma.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  // 静态目录以模块位置定位（不依赖启动 cwd）；setHeaders 加 nosniff 防内容嗅探
  const uploadsDir = join(dirname(fileURLToPath(import.meta.url)), '../uploads');
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads/',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
  await initSensitive(app.get(PrismaService));
  await app.listen(process.env.PORT ?? 3000);
  if (process.env.NODE_ENV === 'production' && !process.env.SMS_PROVIDER) {
    // 生产环境没有短信通道时验证码无法送达，等于登录全断——启动时明确警告
    console.warn('[dp-api] WARNING: production 模式未配置 SMS_PROVIDER，验证码无法送达，登录将不可用（请在接入短信通道前保持 demo 模式）');
  }
}
await bootstrap();
