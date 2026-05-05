/** 관리자 계정 미리보기(해시 없음) */
export interface TeamAdminAccountPreview {
  loginId: string | null;
  hasPassword: boolean;
}

/** 업무 단위 팀 (품질보증1팀, 품질보증2팀 등) */
export interface WorkTeam {
  id: string;
  name: string;
  sortOrder: number;
  /** 팀 관리자 로그인 ID (DB에 저장) */
  adminLoginId?: string | null;
  /** 비밀번호가 설정되어 있는지 (해시는 클라이언트에 비공개) */
  hasAdminPassword?: boolean;
  /** 주 관리자 외 추가 팀 관리자(각자 사번·비밀번호) */
  extraAdminAccounts?: TeamAdminAccountPreview[];
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  /** 사번 (추후 로그인 등에 사용) */
  employeeNo?: string | null;
  /** 사이드바·팀원 목록 원형 프로필에 표시할 이모지(보통 1글자·팔레트에서 선택) */
  avatar?: string;
  /** 팀원 목록 등에 표시하는 짧은 상태메시지 */
  statusMessage?: string | null;
  /** 소속 팀 ID */
  teamId: string;
}

export type WorkStatus = '완료' | '진행중' | '취소';

/** 대분류-소분류 계층 구조용 카테고리 (parent_id NULL = 대분류) */
export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
}

export interface WorkLog {
  id: string;
  memberId: string;
  date: string;
  category: string; // "대분류" 또는 "대분류 > 소분류" 형식
  content: string;
  /** 특이사항 (업무 중 특이사항·비고) */
  issues?: string;
  duration: number; // 총 소요시간 (시간)
  count: number;
  status: WorkStatus;
  /** 업무 지표 분류 */
  workIndicator: WorkIndicatorType;
  /** 동일 업무 단위 ID (저장 시 항상 부여·유지, 여러 일자/상태에 걸친 소요시간 합산에 사용) */
  taskCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkCategory = string; // 레거시 호환: 이제 문자열(display name)

export type WorkIndicatorType = 'R&R/루틴업무' | '현안대응' | '품질고도화 과제' | '조직운영관리' | '기타/행정';

export const WORK_INDICATOR_OPTIONS: WorkIndicatorType[] = ['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'];

/** 엑셀·레거시 JSON 등 구 라벨 `R&R/고유업무` → 신규값 */
export function normalizeWorkIndicator(raw: string | undefined | null): WorkIndicatorType {
  const s = (raw ?? '').trim();
  if (s === 'R&R/고유업무') return 'R&R/루틴업무';
  if ((WORK_INDICATOR_OPTIONS as readonly string[]).includes(s)) return s as WorkIndicatorType;
  return '기타/행정';
}

/** 일 업무시간(8h)에서 차감: 연차 8h·반차 4h·반반차 2h — `dailyWorkHours` 유틸과 동기 */
export type LeaveType = '연차' | '오전 반차' | '오후 반차' | '오후 반반차';

export const LEAVE_TYPE_OPTIONS: LeaveType[] = ['연차', '오전 반차', '오후 반차', '오후 반반차'];
export const WORK_STATUS: WorkStatus[] = ['완료', '진행중', '취소'];
