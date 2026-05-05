/** 관리자 본인 비밀번호 변경 (현재 비밀번호 검증 후 갱신) */
export type ChangeAdminPasswordSelfParams =
  | { scope: 'team'; teamId: string; adminLoginId?: string; currentPassword: string; newPassword: string }
  | { scope: 'global'; adminLoginId?: string; currentPassword: string; newPassword: string }
  | { scope: 'master'; currentPassword: string; newPassword: string };
