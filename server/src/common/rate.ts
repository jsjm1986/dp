/** 进程内滑动窗口频限（单实例部署够用；多实例需换共享存储） */
const buckets = new Map<string, number[]>();

/** 窗口内允许 max 次，超限返回 false。key 建议带前缀区分场景，如 `sms:${mobile}` */
export function checkRate(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// 定期清理过期桶，防 Map 膨胀
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const live = arr.filter((t) => now - t < 3600_000);
    if (live.length) buckets.set(k, live);
    else buckets.delete(k);
  }
}, 10 * 60_000).unref();
