/** duration 합산·표시 시 부동소수점 누적 오차 완화 (4자리) */
export const DURATION_SUM_DECIMALS = 4;

export function finalizeDurationSum(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, n);
  const f = 10 ** DURATION_SUM_DECIMALS;
  return Math.round(clamped * f) / f;
}

export function addDurations(acc: number, d: unknown): number {
  const v = typeof d === 'number' ? d : Number(d);
  return finalizeDurationSum(acc + (Number.isFinite(v) ? v : 0));
}

export function normalizeDurationForStorage(raw: unknown): number {
  const v = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error('소요시간(duration)은 0 이상의 유효한 숫자여야 합니다.');
  }
  return finalizeDurationSum(v);
}

export function normalizeCountForStorage(raw: unknown): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error('건수(count)는 0 이상의 유효한 숫자여야 합니다.');
  }
  return Math.max(0, Math.round(v));
}

/** 가져오기 등 — 예외 없이 DB CHECK를 만족시키기 위한 클램프 */
export function clampDurationForImport(raw: unknown): number {
  const v = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(v) || v < 0) return 0;
  return finalizeDurationSum(v);
}

export function clampCountForImport(raw: unknown): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.max(0, Math.round(v));
}
