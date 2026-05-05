/**
 * 실장급 등 전체 팀 범위 관리자 — 팀 테이블과 별도로 app_settings에 저장
 * 팀 선택 화면·관리자 게이트에서도 동일 ID로 사용
 */
import type { TeamAdminAccountPreview } from '@/types/workLog';

export const GLOBAL_TEAM_ADMIN_SCOPE_ID = '__teamlog_global_team_admin__';

/** 마스터 저장 시 추가 관리자 한 줄 */
export type AdminExtraAccountPayload = {
  adminLoginId: string;
  passwordPlain?: string | null;
};

export type GlobalTeamAdminSavePayload = {
  adminLoginId: string;
  passwordPlain?: string | null;
  extraAdmins?: AdminExtraAccountPayload[];
} | null;

export type GlobalTeamAdminPreview = {
  adminLoginId: string | null;
  hasPassword: boolean;
  extraAccounts?: TeamAdminAccountPreview[];
};
