/**
 * 공수 계산 — 집계 규칙은 plan.md 「2. 집계 규칙」과 동일.
 * taskCode 그룹: duration·count는 그룹 합산, 분류는 그룹 내 최신(날짜) 로그 기준.
 * 인원별 시간: 줄(원시 로그) 단위 귀속.
 */
import type { TeamMember, WorkLog } from '@/types/workLog';
import { addDurations, finalizeDurationSum } from '@/utils/workLogNumeric';

export interface EffortFilters {
  /** 기본 true — 취소 행 제외 */
  excludeCancelled: boolean;
  /** false 권장 — 진행중 포함 */
  excludeInProgress: boolean;
}

export function filterLogsForEffort(
  logs: WorkLog[],
  teamMemberIds: Set<string>,
  startStr: string,
  endStr: string,
  filters: EffortFilters
): WorkLog[] {
  return logs.filter((l) => {
    if (!teamMemberIds.has(l.memberId)) return false;
    if (l.date < startStr || l.date > endStr) return false;
    if (filters.excludeCancelled && l.status === '취소') return false;
    if (filters.excludeInProgress && l.status === '진행중') return false;
    return true;
  });
}

export function parseCategory(category: string): { major: string; sub: string | null } {
  const c = category?.trim() || '';
  if (c.includes(' > ')) {
    const idx = c.indexOf(' > ');
    const major = c.slice(0, idx).trim();
    const sub = c.slice(idx + 3).trim();
    return { major: major || c, sub: sub || null };
  }
  return { major: c, sub: null };
}

/** taskCode 묶음 + 비코드 1줄 1유닛 */
export interface MergedEffortUnit {
  memberId: string;
  taskCode: string | null;
  totalDuration: number;
  /** 안 A: 일자별 count 합 */
  countSum: number;
  major: string;
  sub: string;
  categoryDisplay: string;
  dateMin: string;
  dateMax: string;
  distinctDayCount: number;
}

export function buildMergedEffortUnits(logs: WorkLog[]): MergedEffortUnit[] {
  const byKey = new Map<string, WorkLog[]>();
  const noCode: WorkLog[] = [];
  for (const log of logs) {
    if (!log.taskCode) {
      noCode.push(log);
      continue;
    }
    const k = `${log.memberId}\t${log.taskCode}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(log);
  }
  const out: MergedEffortUnit[] = [];
  for (const [, group] of byKey) {
    const dates = [...new Set(group.map((l) => l.date))].sort();
    const latest = [...group].sort((a, b) => b.date.localeCompare(a.date))[0]!;
    const { major, sub } = parseCategory(latest.category);
    out.push({
      memberId: latest.memberId,
      taskCode: latest.taskCode!,
      totalDuration: group.reduce((s, l) => addDurations(s, l.duration), 0),
      countSum: group.reduce((s, l) => s + l.count, 0),
      major,
      sub: sub ?? '-',
      categoryDisplay: latest.category,
      dateMin: dates[0]!,
      dateMax: dates[dates.length - 1]!,
      distinctDayCount: dates.length,
    });
  }
  for (const log of noCode) {
    const { major, sub } = parseCategory(log.category);
    out.push({
      memberId: log.memberId,
      taskCode: null,
      totalDuration: log.duration,
      countSum: log.count,
      major,
      sub: sub ?? '-',
      categoryDisplay: log.category,
      dateMin: log.date,
      dateMax: log.date,
      distinctDayCount: 1,
    });
  }
  return out;
}

export interface EffortBucketRow {
  key: string;
  major: string;
  sub: string | null;
  totalDuration: number;
  totalCount: number;
  perCase: number | null;
  participantCount: number;
  standardHours: number | null;
  varianceHours: number | null;
  variancePct: number | null;
}

export function aggregateByMajor(
  units: MergedEffortUnit[],
  rawFilteredLogs: WorkLog[],
  standardsMajor: Record<string, number>
): EffortBucketRow[] {
  const map = new Map<string, { duration: number; count: number }>();
  for (const u of units) {
    if (!map.has(u.major)) map.set(u.major, { duration: 0, count: 0 });
    const g = map.get(u.major)!;
    g.duration = addDurations(g.duration, u.totalDuration);
    g.count += u.countSum;
  }
  const participants = new Map<string, Set<string>>();
  for (const log of rawFilteredLogs) {
    const { major } = parseCategory(log.category);
    if (!participants.has(major)) participants.set(major, new Set());
    if (log.duration > 0) participants.get(major)!.add(log.memberId);
  }
  const rows: EffortBucketRow[] = [];
  for (const [major, { duration, count }] of map) {
    const std = standardsMajor[major];
    const standardHours = std !== undefined && !Number.isNaN(std) ? std : null;
    const perCase = count > 0 ? finalizeDurationSum(duration / count) : null;
    const varianceHours = standardHours != null ? duration - standardHours : null;
    const variancePct =
      standardHours != null && standardHours > 0 ? ((duration - standardHours) / standardHours) * 100 : null;
    rows.push({
      key: major,
      major,
      sub: null,
      totalDuration: duration,
      totalCount: count,
      perCase,
      participantCount: participants.get(major)?.size ?? 0,
      standardHours,
      varianceHours,
      variancePct,
    });
  }
  return rows.sort((a, b) => b.totalDuration - a.totalDuration);
}

export function aggregateBySub(
  units: MergedEffortUnit[],
  rawFilteredLogs: WorkLog[],
  standardsSub: Record<string, number>
): EffortBucketRow[] {
  const map = new Map<string, { major: string; sub: string; duration: number; count: number }>();
  for (const u of units) {
    const key = `${u.major}\t${u.sub}`;
    if (!map.has(key)) map.set(key, { major: u.major, sub: u.sub, duration: 0, count: 0 });
    const g = map.get(key)!;
    g.duration = addDurations(g.duration, u.totalDuration);
    g.count += u.countSum;
  }
  const participants = new Map<string, Set<string>>();
  for (const log of rawFilteredLogs) {
    const { major, sub } = parseCategory(log.category);
    const subKey = sub ?? '-';
    const k = `${major}\t${subKey}`;
    if (!participants.has(k)) participants.set(k, new Set());
    if (log.duration > 0) participants.get(k)!.add(log.memberId);
  }
  const rows: EffortBucketRow[] = [];
  for (const [k, { major, sub, duration, count }] of map) {
    const displaySub = `${major} > ${sub}`;
    const std =
      standardsSub[displaySub] ?? standardsSub[k] ?? (sub === '-' ? standardsSub[major] : undefined);
    const standardHours = std !== undefined && !Number.isNaN(std) ? std : null;
    const perCase = count > 0 ? finalizeDurationSum(duration / count) : null;
    const varianceHours = standardHours != null ? duration - standardHours : null;
    const variancePct =
      standardHours != null && standardHours > 0 ? ((duration - standardHours) / standardHours) * 100 : null;
    rows.push({
      key: k,
      major,
      sub,
      totalDuration: duration,
      totalCount: count,
      perCase,
      participantCount: participants.get(k)?.size ?? 0,
      standardHours,
      varianceHours,
      variancePct,
    });
  }
  return rows.sort((a, b) => b.totalDuration - a.totalDuration);
}

/** 줄 단위: 대분류별 인원 시간 */
export function memberHoursByMajor(
  rawFilteredLogs: WorkLog[],
  memberById: Map<string, TeamMember>
): { major: string; memberId: string; memberName: string; hours: number }[] {
  const map = new Map<string, number>();
  for (const log of rawFilteredLogs) {
    const { major } = parseCategory(log.category);
    const key = `${major}\t${log.memberId}`;
    map.set(key, addDurations(map.get(key) ?? 0, log.duration));
  }
  const out: { major: string; memberId: string; memberName: string; hours: number }[] = [];
  for (const [key, hours] of map) {
    const tab = key.indexOf('\t');
    const major = key.slice(0, tab);
    const memberId = key.slice(tab + 1);
    out.push({
      major,
      memberId,
      memberName: memberById.get(memberId)?.name ?? memberId,
      hours,
    });
  }
  return out.sort((a, b) => a.major.localeCompare(b.major) || b.hours - a.hours);
}

export function groupMemberHoursByMajor(
  rows: { major: string; memberId: string; memberName: string; hours: number }[]
): Map<string, { memberId: string; memberName: string; hours: number }[]> {
  const m = new Map<string, { memberId: string; memberName: string; hours: number }[]>();
  for (const r of rows) {
    if (!m.has(r.major)) m.set(r.major, []);
    m.get(r.major)!.push({ memberId: r.memberId, memberName: r.memberName, hours: r.hours });
  }
  for (const [, arr] of m) arr.sort((a, b) => b.hours - a.hours);
  return m;
}

const STORAGE_PREFIX = 'teamlog.effortStandards.v1';

export interface EffortStandards {
  /** 대분류명 → 선택 기간 대비 목표 시간(h) */
  majors: Record<string, number>;
  /** "대분류 > 소분류" 또는 대분류만 키 → 목표 시간(h) */
  subs: Record<string, number>;
}

export function loadEffortStandards(teamId: string): EffortStandards {
  if (typeof localStorage === 'undefined') return { majors: {}, subs: {} };
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${teamId}`);
    if (!raw) return { majors: {}, subs: {} };
    const p = JSON.parse(raw) as Partial<EffortStandards>;
    return {
      majors: typeof p.majors === 'object' && p.majors ? p.majors : {},
      subs: typeof p.subs === 'object' && p.subs ? p.subs : {},
    };
  } catch {
    return { majors: {}, subs: {} };
  }
}

export function saveEffortStandards(teamId: string, data: EffortStandards): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`${STORAGE_PREFIX}:${teamId}`, JSON.stringify(data));
}

/** 유닛 1건의 건당(h). 건수 0이면 제외 */
export function unitPerCase(u: MergedEffortUnit): number | null {
  if (u.countSum <= 0) return null;
  return finalizeDurationSum(u.totalDuration / u.countSum);
}

function sortedNumbers(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

function medianSorted(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 선형 보간 분위수 (0~1), 정렬된 배열 */
export function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - pos) + sorted[hi]! * (pos - lo);
}

export type DataBaselineMode = 'median' | 'mean';

/** 같은 키(대분류 또는 대분류+소분) 안의 유닛 건당 표본으로 기준·IQR */
export interface UnitBaselineStats {
  baselinePerCase: number | null;
  unitCount: number;
  q1: number | null;
  q3: number | null;
}

export function computeUnitBaselineStats(perCases: number[], mode: DataBaselineMode): UnitBaselineStats {
  if (perCases.length === 0) return { baselinePerCase: null, unitCount: 0, q1: null, q3: null };
  const s = sortedNumbers(perCases);
  const baseline =
    mode === 'median'
      ? medianSorted(s)
      : perCases.reduce((a, b) => a + b, 0) / perCases.length;
  let q1: number | null = null;
  let q3: number | null = null;
  if (s.length >= 2) {
    q1 = quantileSorted(s, 0.25);
    q3 = quantileSorted(s, 0.75);
  }
  return { baselinePerCase: baseline, unitCount: perCases.length, q1, q3 };
}

export function collectPerCasesByMajor(units: MergedEffortUnit[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const u of units) {
    const pc = unitPerCase(u);
    if (pc == null) continue;
    if (!m.has(u.major)) m.set(u.major, []);
    m.get(u.major)!.push(pc);
  }
  return m;
}

export function collectPerCasesBySub(units: MergedEffortUnit[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const u of units) {
    const pc = unitPerCase(u);
    if (pc == null) continue;
    const k = `${u.major}\t${u.sub}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(pc);
  }
  return m;
}

/** IQR 판정에 필요한 최소 유닛 수 (소분류별 건당 표본) */
export const MIN_UNITS_FOR_IQR_OUTLIER = 5;

/** plan.md §12.3 — 상단 꼬리 3단계 + 표본 부족 */
export type EffortIqrTier = 'collecting' | 'normal' | 'caution' | 'severe';

/**
 * 동일 소분류 내 건당(h) 표본 `sortedOrUnsortedPerCases`에 대해 Q1·Q3·IQR을 쓰고,
 * 값 v를 plan.md §12.3 울타리와 비교한다. 표본 5건 미만은 `collecting`.
 */
export function classifyPerCaseUpperIqrTiers(
  value: number | null,
  sortedOrUnsortedPerCases: number[]
): EffortIqrTier {
  if (value == null || sortedOrUnsortedPerCases.length < MIN_UNITS_FOR_IQR_OUTLIER) return 'collecting';
  const s = sortedNumbers(sortedOrUnsortedPerCases);
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return 'normal';
  const mildFence = q3 + 1.5 * iqr;
  const severeFence = q3 + 3.0 * iqr;
  if (value <= mildFence) return 'normal';
  if (value <= severeFence) return 'caution';
  return 'severe';
}

/** 대분류별로 소분류 행의 IQR 상태를 모은 뒤 집중 관리 우선순위를 계산한다. */
export interface MajorStatusRollup {
  major: string;
  /** 해당 대분류의 소분류 행 수 */
  subCount: number;
  byTier: Record<EffortIqrTier, number>;
  hoursByTier: Record<EffortIqrTier, number>;
  /** 높을수록 집중 관리가 필요한 대분류로 정렬에 사용 */
  focusPriority: number;
}

function emptyTierRecord(): Record<EffortIqrTier, number> {
  return { collecting: 0, normal: 0, caution: 0, severe: 0 };
}

/**
 * 소분류별 상태(정상/주의/이상/집계중)를 대분류로 합산하고, **집중 관리** 우선순위로 정렬한다.
 * 우선순위: 이상·주의 소요시간 비중, 해당 건수 가중.
 */
export function rollupMajorStatusesFromSubRows(
  subRows: EffortBucketRow[],
  perCaseBySubKey: Map<string, number[]>
): MajorStatusRollup[] {
  const byMajor = new Map<
    string,
    { byTier: Record<EffortIqrTier, number>; hoursByTier: Record<EffortIqrTier, number> }
  >();
  for (const r of subRows) {
    const list = perCaseBySubKey.get(r.key) ?? [];
    const tier = classifyPerCaseUpperIqrTiers(r.perCase, list);
    if (!byMajor.has(r.major)) {
      byMajor.set(r.major, { byTier: emptyTierRecord(), hoursByTier: emptyTierRecord() });
    }
    const g = byMajor.get(r.major)!;
    g.byTier[tier] += 1;
    g.hoursByTier[tier] += r.totalDuration;
  }
  const rows: MajorStatusRollup[] = [];
  for (const [major, v] of byMajor) {
    const subCount =
      v.byTier.collecting + v.byTier.normal + v.byTier.caution + v.byTier.severe;
    const focusPriority =
      v.hoursByTier.severe * 1000 +
      v.hoursByTier.caution * 120 +
      v.byTier.severe * 80 +
      v.byTier.caution * 40 +
      v.hoursByTier.collecting * 4 +
      v.byTier.collecting * 2;
    rows.push({ major, subCount, byTier: v.byTier, hoursByTier: v.hoursByTier, focusPriority });
  }
  return rows.sort((a, b) => {
    if (b.focusPriority !== a.focusPriority) return b.focusPriority - a.focusPriority;
    return a.major.localeCompare(b.major, 'ko');
  });
}

/** 전체 소분류 행 기준 상태 건수 */
export function aggregateGlobalSubTierCounts(
  subRows: EffortBucketRow[],
  perCaseBySubKey: Map<string, number[]>
): Record<EffortIqrTier, number> {
  const c = emptyTierRecord();
  for (const r of subRows) {
    const tier = classifyPerCaseUpperIqrTiers(r.perCase, perCaseBySubKey.get(r.key) ?? []);
    c[tier] += 1;
  }
  return c;
}

/** 하위 호환: 구버전 양방향 IQR (과다/저조). 신규 UI는 `classifyPerCaseUpperIqrTiers` 사용. */
export function aggregatePerCaseOutlierIqr(
  aggregatePerCase: number | null,
  q1: number | null,
  q3: number | null,
  unitCount: number
): 'high' | 'low' | null {
  if (aggregatePerCase == null || q1 == null || q3 == null) return null;
  if (unitCount < MIN_UNITS_FOR_IQR_OUTLIER) return null;
  const iqr = q3 - q1;
  if (iqr <= 0) return null;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  if (aggregatePerCase > high) return 'high';
  if (aggregatePerCase < low) return 'low';
  return null;
}

/** 소분류 키에 속한 유닛만 필터 */
export function unitsForSubKey(units: MergedEffortUnit[], major: string, sub: string): MergedEffortUnit[] {
  return units.filter((u) => u.major === major && u.sub === sub);
}

/** 대분류에 속한 유닛 전체(모든 소분류) */
export function unitsForMajor(units: MergedEffortUnit[], major: string): MergedEffortUnit[] {
  return units.filter((u) => u.major === major);
}

/** 유닛에 대응하는 기간 내 원시 로그(일자순). taskCode 없으면 분류·날짜로 매칭 */
export function logsForMergedUnit(filteredLogs: WorkLog[], u: MergedEffortUnit): WorkLog[] {
  if (u.taskCode) {
    return filteredLogs
      .filter((l) => l.memberId === u.memberId && l.taskCode === u.taskCode)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return filteredLogs
    .filter((l) => {
      if (l.memberId !== u.memberId || l.taskCode) return false;
      const { major, sub } = parseCategory(l.category);
      const s = sub ?? '-';
      return major === u.major && s === u.sub && l.date >= u.dateMin && l.date <= u.dateMax;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildBaselineStatsMaps(
  units: MergedEffortUnit[],
  mode: DataBaselineMode
): {
  byMajor: Map<string, UnitBaselineStats>;
  bySub: Map<string, UnitBaselineStats>;
} {
  const byMajor = new Map<string, UnitBaselineStats>();
  const bySub = new Map<string, UnitBaselineStats>();
  const majorPcs = collectPerCasesByMajor(units);
  const subPcs = collectPerCasesBySub(units);
  for (const [k, arr] of majorPcs) {
    byMajor.set(k, computeUnitBaselineStats(arr, mode));
  }
  for (const [k, arr] of subPcs) {
    bySub.set(k, computeUnitBaselineStats(arr, mode));
  }
  return { byMajor, bySub };
}
