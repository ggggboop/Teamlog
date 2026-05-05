/** app_settings 키 — 값이 `yyyy-MM-dd`이면 해당 일부터 업무 기록 작성 가능(이전 일자는 작성 불가, 연차·반차는 가능) */
export const GLOBAL_WORK_RECORD_START_DATE_KEY = 'global_work_record_start_date';

export function parseWorkRecordStartDate(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/** 업무 기록이 이 시작일 미만이면 잠금 */
export function isDateBeforeWorkRecordStart(dateStr: string, startDate: string | null): boolean {
  if (!startDate) return false;
  return dateStr < startDate;
}
