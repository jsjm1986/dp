/** 北京时间工具：业务口径统一 UTC+8，与用户设备时区无关（与后端 bjDateKey/bjDayStart 对齐） */
const BJ_OFFSET = 8 * 3600_000;

/** 北京时间日期串 YYYY-MM-DD */
export function bjDateKey(d: Date): string {
  const t = new Date(d.getTime() + BJ_OFFSET);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 北京今日零点（绝对时刻），用于 van-calendar minDate */
export function bjTodayStart(): Date {
  const t = new Date(Date.now() + BJ_OFFSET);
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - BJ_OFFSET);
}

/** 北京时间当前小时 */
export function bjHour(d = new Date()): number {
  return new Date(d.getTime() + BJ_OFFSET).getUTCHours();
}
