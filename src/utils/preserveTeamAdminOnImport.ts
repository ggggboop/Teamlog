import type { WorkTeam } from '@/types/workLog';

/**
 * 가져오기·샘플데이터 적용 등에서 팀 메타만 갱신하고 관리자 계정은 건드리지 않을 때 true.
 * (내보내기 JSON처럼 adminLoginId·비밀번호 플래그·추가 관리자가 비어 있는 경우)
 */
export function shouldPreserveImportedTeamAdmin(t: WorkTeam): boolean {
  if ((t.adminLoginId ?? '').trim().length > 0) return false;
  if (t.hasAdminPassword) return false;
  const extras = t.extraAdminAccounts ?? [];
  if (extras.some((e) => (e.loginId ?? '').trim().length > 0)) return false;
  return true;
}
