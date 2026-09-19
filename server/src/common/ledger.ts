import { Prisma } from '../generated/prisma/client.js';

export type LedgerType =
  | 'recharge'
  | 'card'
  | 'pay'
  | 'refund'
  | 'commission'
  | 'adjust'
  | 'income'
  | 'withdraw'
  | 'withdraw_refund';

/** 在既有事务内记一条余额流水（与余额变动同事务提交） */
export function logBalance(
  tx: Prisma.TransactionClient,
  entry: { userId?: string; partnerId?: string; type: LedgerType; amount: number; refId?: string; remark?: string },
) {
  return tx.balanceLog.create({ data: entry });
}

const BJ_OFFSET = 8 * 3600_000;

/** 北京时间小时数：与用户端整点选择一致，不随服务器时区漂移 */
export function bjHour(d: Date) {
  return new Date(d.getTime() + BJ_OFFSET).getUTCHours();
}

/** 北京时间零点（绝对时刻），用于按北京日聚合 */
export function bjDayStart(d: Date) {
  const t = new Date(d.getTime() + BJ_OFFSET);
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - BJ_OFFSET);
}

/** 北京时间日期串 YYYY-MM-DD */
export function bjDateKey(d: Date) {
  const t = new Date(d.getTime() + BJ_OFFSET);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 订单占用的绝对时间区间 [start, end)（ms）。
 * 「天」类 → 该北京日全天；「小时」按 num 展开；其他单位默认占 1 小时。
 * 用区间重叠做冲突判断可正确处理跨零点订单（23 点起 3 小时会占次日 0-2 点）。
 */
export function orderRange(appointAt: Date, items: Array<{ unit: string; num: number }>): { start: number; end: number } {
  const t = appointAt.getTime();
  if (items.some((i) => i.unit === '天')) {
    const dayStart = bjDayStart(appointAt).getTime();
    return { start: dayStart, end: dayStart + 86400_000 };
  }
  const span = items.reduce((m, i) => (i.unit === '小时' ? Math.max(m, i.num) : m), 1);
  return { start: t, end: t + span * 3600_000 };
}
