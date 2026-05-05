/**
 * 마스터 관리 화면 전용: 이 브라우저에서 "저장"한 관리자 비밀번호 평문을 localStorage에 보관합니다.
 * DB에는 해시만 있으므로 재로그인 후에도 입력란에 표시하려면 클라이언트 캐시가 필요합니다.
 * (PC 공유 시 유출 위험이 있으니 사용 환경을 고려하세요.)
 */
const STORAGE_KEY = 'teamlog_master_panel_pw_plain_v1';

export function loadMasterPanelPasswordCache(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, string>;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function mergeMasterPanelPasswordCache(partial: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = loadMasterPanelPasswordCache();
    for (const [k, v] of Object.entries(partial)) {
      if (v && typeof v === 'string') cur[k] = v;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
  } catch {
    /* quota / private mode */
  }
}
