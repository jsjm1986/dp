/** 安全的整型参数解析：非法/缺失返回 undefined，可设默认值与上下界 */
export function toInt(v: string | undefined, opts?: { def?: number; min?: number; max?: number }): number | undefined {
  if (v === undefined || v === '') return opts?.def;
  const n = Number(v);
  if (!Number.isFinite(n)) return opts?.def;
  let r = Math.floor(n);
  if (opts?.min != null) r = Math.max(opts.min, r);
  if (opts?.max != null) r = Math.min(opts.max, r);
  return r;
}

/** 安全的浮点参数解析 */
export function toNum(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
