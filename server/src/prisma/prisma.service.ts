import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { fileURLToPath } from 'url';
import { PrismaClient } from '../generated/prisma/client.js';

// dev.db 定位到 server 目录（src/ 与 dist/ 下均为 ../../dev.db），不依赖 cwd
const defaultDbUrl = `file:${fileURLToPath(new URL('../../dev.db', import.meta.url))}`;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaBetterSqlite3({
        url: process.env.DATABASE_URL ?? defaultDbUrl,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    // SQLite 默认不强制外键；WAL + busy_timeout 降低并发写冲突
    await this.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
    await this.$executeRawUnsafe('PRAGMA journal_mode = WAL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
