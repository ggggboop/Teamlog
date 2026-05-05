import type { LeaveType } from '@/types/workLog';

/** 근무일 기준 기본 근로시간(고정) */
export const STANDARD_DAY_HOURS = 8 as const;

/**
 * 휴가 유형에 따른 기본 8h에서 깎는 시간.
 * - 연차: 8 → 당일 근무 한도 0h (+ 연장만 가산)
 * - 오전/오후 반차: 4h 차감 → 4h
 * - 오후 반반차: 2h 차감 → 6h
 */
export function leaveTypeToDeductionHours(leaveType: string | null | undefined): number {
  if (!leaveType) return 0;
  switch (leaveType as LeaveType | string) {
    case '연차':
      return 8;
    case '오전 반차':
    case '오후 반차':
      return 4;
    case '오후 반반차':
      return 2;
    default:
      return 0;
  }
}

/** 연차 환산일: 연차 1 · 반차 0.5 · 반반차 0.25 (알 수 없는 유형 0) */
export function leaveTypeToUsedLeaveDays(leaveType: string | null | undefined): number {
  if (!leaveType) return 0;
  switch (leaveType as LeaveType | string) {
    case '연차':
      return 1;
    case '오전 반차':
    case '오후 반차':
      return 0.5;
    case '오후 반반차':
      return 0.25;
    default:
      return 0;
  }
}

/**
 * 일 업무시간(일별 총 업무 한도) = max(0, 8 − 휴가차감) + 연장(≥0)
 */
export function computeDailyWorkHoursLimit(
  leaveType: string | null | undefined,
  extensionHours: number
): number {
  const ded = leaveTypeToDeductionHours(leaveType);
  const base = Math.max(0, STANDARD_DAY_HOURS - ded);
  const ext =
    Number.isFinite(extensionHours) && extensionHours > 0 ? extensionHours : 0;
  return Math.max(0, base + ext);
}
