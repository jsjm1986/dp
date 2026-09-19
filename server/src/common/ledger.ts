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

/** 订单占用的小时段集合（北京时间）：appointAt 起按 items 展开；含「天」返回 null 表示全天占用 */
export function orderHours(appointAt: Date, items: Array<{ unit: string; num: number }>): number[] | null {
  if (items.some((i) => i.unit === '天')) return null;
  const start = bjHour(appointAt);
  const span = items.reduce((m, i) => (i.unit === '小时' ? Math.max(m, i.num) : m), 1);
  const hours: number[] = [];
  for (let h = start; h < Math.min(start + span, 24); h++) hours.push(h);
  return hours;
}
