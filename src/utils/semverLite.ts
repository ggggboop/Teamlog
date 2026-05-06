/** package.json 버전 문자열 비교 (추가 의존성 없음) */

export function parseSemverLoose(input: string): number[] | null {
  const t = String(input ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)*)/);
  if (!m) return null;
  return m[1]!.split('.').map((x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  });
}

/** 음수면 a<b, 0이면 같음, 양수면 a>b. 파싱 실패 시 NaN */
export function compareSemverLoose(a: string, b: string): number {
  const pa = parseSemverLoose(a);
  const pb = parseSemverLoose(b);
  if (!pa || !pb) return NaN;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** minimum이 비어 있거나 유효하지 않으면 false (차단 안 함) */
export function versionLessThan(current: string, minimum: string): boolean {
  const min = String(minimum ?? '').trim();
  if (!min) return false;
  const cmp = compareSemverLoose(current, min);
  if (Number.isNaN(cmp)) return false;
  return cmp < 0;
}
