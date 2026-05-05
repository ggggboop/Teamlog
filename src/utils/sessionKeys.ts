export const SESSION_ROLE_KEY = 'teamlog_session_role';
export const SELECTED_TEAM_ID_KEY = 'teamlog_selected_team_id';
/** 마지막 로그인 사번(localStorage, 해당 브라우저만) */
export const LAST_LOGIN_EMPLOYEE_KEY = 'teamlog_last_login_employee';

export function getLastLoginEmployee(): string | null {
  try {
    const v = localStorage.getItem(LAST_LOGIN_EMPLOYEE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setLastLoginEmployee(employeeId: string): void {
  try {
    const t = employeeId.trim();
    if (t) localStorage.setItem(LAST_LOGIN_EMPLOYEE_KEY, t);
  } catch {
    /* ignore */
  }
}
export const teamAdminOkKey = (teamId: string) => `teamlog_team_admin_ok_${teamId}`;

export function getStoredTeamId(): string | null {
  try {
    return localStorage.getItem(SELECTED_TEAM_ID_KEY);
  } catch {
    return null;
  }
}

export function setStoredTeamId(id: string): void {
  try {
    localStorage.setItem(SELECTED_TEAM_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearStoredTeamId(): void {
  try {
    localStorage.removeItem(SELECTED_TEAM_ID_KEY);
  } catch {
    /* ignore */
  }
}

/** 팀 선택 화면에서는 writer·admin만 쓰고, 마스터는 관리자 게이트에서 마스터 인증 시 부여됩니다. */
export type StoredSessionRole = 'writer' | 'admin' | 'master';

export function getSessionRole(): StoredSessionRole | null {
  try {
    const v = localStorage.getItem(SESSION_ROLE_KEY);
    if (v === 'writer' || v === 'admin' || v === 'master') return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function setSessionRole(role: StoredSessionRole): void {
  try {
    localStorage.setItem(SESSION_ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}

export function clearSessionRole(): void {
  try {
    localStorage.removeItem(SESSION_ROLE_KEY);
  } catch {
    /* ignore */
  }
}

export function getTeamAdminOk(teamId: string): boolean {
  try {
    return localStorage.getItem(teamAdminOkKey(teamId)) === '1';
  } catch {
    return false;
  }
}

export function setTeamAdminOk(teamId: string, ok: boolean): void {
  try {
    if (ok) localStorage.setItem(teamAdminOkKey(teamId), '1');
    else localStorage.removeItem(teamAdminOkKey(teamId));
  } catch {
    /* ignore */
  }
}

export function clearAllTeamAdminOk(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('teamlog_team_admin_ok_'));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
