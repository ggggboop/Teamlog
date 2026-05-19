/**
 * DatabaseAdapter - 추상화된 데이터베이스 인터페이스
 * 
 * ⚠️ 중요: 이 인터페이스는 절대 변경하지 마세요!
 * Electron 전환 시 SQLite 어댑터만 교체할 예정입니다.
 * 
 * ===== 아키텍처 규칙 =====
 * 
 * [웹 환경 (현재)]
 * - InMemoryAdapter만 사용 (배열 기반)
 * - 새로고침 시 데이터 초기화됨
 * - IndexedDB, localStorage 사용 금지
 * - 미리보기/UX 테스트 전용
 * - 동시성 고려 안 함
 * 
 * [Electron 환경]
 * - PostgreSQL (pg Pool), 메인 프로세스
 * - userData/settings.json 의 pg 또는 PG* 환경 변수
 */

import { TeamMember, WorkLog, Category, WorkTeam } from '@/types/workLog';
import type { AdminExtraAccountPayload, GlobalTeamAdminSavePayload } from '@/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';

/** 일괄 저장(삭제→수정→추가) 단일 트랜잭션 — 모든 작업이 동일 작성자 소유여야 함 */
export interface SaveLogsBatchPayload {
  requesterMemberId: string;
  deletedLogIds: string[];
  updatedLogs: { id: string; updates: Partial<WorkLog> }[];
  newLogs: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>[];
}

/** PostgreSQL 연결 요약 (Electron 메인 — 비밀번호 제외) */
export interface PgConnectionInfo {
  host: string;
  port: number;
  user: string;
  database: string;
}

export interface DatabaseConfig {
  /** DB 파일 경로 (Electron SQLite 레거시; PostgreSQL에서는 미사용) */
  dbPath?: string;
  /** PostgreSQL 연결 요약 (비밀번호 비포함) */
  pg?: PgConnectionInfo;
  /** 연결 성공 여부 */
  isConnected: boolean;
  /** 현재 어댑터 타입 */
  adapterType: 'indexeddb' | 'sqlite' | 'postgresql';
}

export interface IDatabaseAdapter {
  /** 데이터베이스 초기화 및 연결 */
  initialize(): Promise<void>;
  
  /** 현재 설정 조회 */
  getConfig(): DatabaseConfig;
  
  /** DB 경로 변경 (Electron에서만 유효) */
  setDbPath(path: string): Promise<void>;
  
  /** DB 연결 상태 확인 */
  isConnected(): boolean;

  // ==================== Teams ====================
  getTeams(): Promise<WorkTeam[]>;
  insertTeam(name: string): Promise<WorkTeam>;
  /** 마스터(전역 관리자 설정) 로그인 검증 */
  verifyMasterLogin(loginId: string, password: string): Promise<boolean>;
  /** 팀 관리자 로그인 검증 */
  verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean>;
  /** 관리자 설정 일괄 저장 (트랜잭션) */
  saveAdminTeamsTransaction(payload: {
    teams: Array<{
      id: string;
      name: string;
      department?: string | null;
      sortOrder: number;
      adminLoginId: string;
      passwordPlain?: string | null;
      extraAdmins?: AdminExtraAccountPayload[];
    }>;
    deletedTeamIds: string[];
    /** 전체팀(실장급 등) 관리자 — null이면 해당 자격 정보 삭제 */
    globalTeamAdmin?: GlobalTeamAdminSavePayload;
    /** `yyyy-MM-dd` — 해당 일부터 업무 기록 작성 가능. `null`/빈 문자열이면 제한 없음 */
    workRecordStartDate?: string | null;
  }): Promise<void>;
  /** 관리자 본인 비밀번호 변경 (내장 우회 계정은 어댑터에서 거부) */
  changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void>;

  // ==================== Members ====================
  getAllMembers(): Promise<TeamMember[]>;
  getMembersByTeam(teamId: string): Promise<TeamMember[]>;
  getMemberById(id: string): Promise<TeamMember | null>;
  insertMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember>;
  updateMember(id: string, updates: Partial<TeamMember>): Promise<void>;
  deleteMember(id: string): Promise<void>;

  // ==================== Work Logs ====================
  getAllLogs(): Promise<WorkLog[]>;
  getLogsByTeam(teamId: string): Promise<WorkLog[]>;
  getLogsByMemberId(memberId: string): Promise<WorkLog[]>;
  getLogsByDateRange(startDate: string, endDate: string): Promise<WorkLog[]>;
  /** `requesterMemberId`가 있으면(Electron IPC) 해당 멤버 소유 행만 추가·수정·삭제 가능 */
  insertLog(
    log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>,
    requesterMemberId?: string | null
  ): Promise<WorkLog>;
  updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void>;
  deleteLog(id: string, requesterMemberId?: string | null): Promise<void>;
  deleteLogsByMemberId(memberId: string): Promise<void>;
  saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void>;

  // ==================== Categories ====================
  getAllCategories(): Promise<string[]>;
  getCategoriesTree(): Promise<Category[]>;
  saveCategories(categories: string[]): Promise<void>;
  saveCategoriesTree(categories: Category[]): Promise<void>;

  // ==================== Settings ====================
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // ==================== Data Management ====================
  /** DB 갱신 시 실시간 이벤트 구독 (PostgreSQL LISTEN/NOTIFY 활용). 구독 해제 함수 반환 */
  onDbChange?(callback: (payload: string) => void): () => void;

  /** 감사 로그 조회 (최신순) */
  getAuditLogs?(limit?: number): Promise<import('../types/workLog').AuditLog[]>;

  /** 모든 데이터 삭제 (초기화) */
  clearAllData(): Promise<void>;
  
  /** 데이터 내보내기 */
  exportData(): Promise<{
    teams: WorkTeam[];
    members: TeamMember[];
    logs: WorkLog[];
    categories: string[];
  }>;
  
  /** 데이터 가져오기 */
  importData(data: {
    teams?: WorkTeam[];
    members: TeamMember[];
    logs: WorkLog[];
    categories: string[];
  }): Promise<void>;
}

/** 기본 카테고리 목록 (대분류, 대분류 > 소분류 혼합) */
export const DEFAULT_CATEGORIES: string[] = [
  '기획', '개발', '디자인', '회의', '문서작업', '고객응대', '교육/학습', '검토/QA',
  '검토/QA > GMP 기록', '검토/QA > 검증 문서', '검토/QA > 시험 데이터', '기타',
];
