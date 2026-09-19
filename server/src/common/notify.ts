import type { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

type Db = PrismaService | Prisma.TransactionClient;

export type NoticeType = 'order' | 'audit' | 'wallet' | 'commission' | 'system';

/** 站内通知：失败不阻断主流程（通知丢失可接受，业务不可丢） */
export async function notify(
  db: Db,
  n: { userId: string; type: NoticeType; title: string; content: string; refId?: string },
) {
  try {
    await db.notice.create({
      data: { userId: n.userId, type: n.type, title: n.title, content: n.content.slice(0, 200), refId: n.refId },
    });
  } catch {
    /* 通知失败静默 */
  }
}
