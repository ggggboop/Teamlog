import type { TeamAdminAccountPreview } from '@/types/workLog';
import type { AdminExtraAccountPayload } from '@/constants/globalTeamAdmin';

export type StoredAdminExtra = { loginId: string; passwordHash: string };

export function parseStoredAdminExtras(json: string | null | undefined | unknown): StoredAdminExtra[] {
  if (!json) return [];
  if (typeof json === 'string' && !json.trim()) return [];
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) return [];
    const out: StoredAdminExtra[] = [];
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue;
      const o = x as { loginId?: unknown; passwordHash?: unknown };
      const loginId = typeof o.loginId === 'string' ? o.loginId.trim() : '';
      const passwordHash = typeof o.passwordHash === 'string' ? o.passwordHash : '';
      if (loginId && passwordHash) out.push({ loginId, passwordHash });
    }
    return out;
  } catch {
    return [];
  }
}

export function toPreviewExtras(stored: StoredAdminExtra[]): TeamAdminAccountPreview[] {
  return stored.map((s) => ({
    loginId: s.loginId,
    hasPassword: !!s.passwordHash,
  }));
}

export function serializeAdminExtras(stored: StoredAdminExtra[]): string {
  return JSON.stringify(stored);
}

/** 저장 시: 기존 해시 유지(비번 비움) 또는 새 해시 */
export async function mergeAdminExtrasOnSave(
  oldJson: string | null | undefined | unknown,
  payloadRows: AdminExtraAccountPayload[],
  hashPassword: (pw: string) => Promise<string> | string
): Promise<StoredAdminExtra[]> {
  const old = parseStoredAdminExtras(oldJson);
  const oldByLogin = new Map(old.map((o) => [o.loginId, o.passwordHash]));
  const result: StoredAdminExtra[] = [];
  const seen = new Set<string>();
  for (const row of payloadRows) {
    const lid = row.adminLoginId.trim();
    if (!lid) continue;
    if (seen.has(lid)) {
      throw new Error(`같은 관리 범위에 사번이 중복되었습니다: ${lid}`);
    }
    seen.add(lid);
    const pw = row.passwordPlain?.trim();
    if (pw) {
      const h = await Promise.resolve(hashPassword(pw));
      result.push({ loginId: lid, passwordHash: h });
    } else {
      const prev = oldByLogin.get(lid);
      if (prev) {
        result.push({ loginId: lid, passwordHash: prev });
      } else {
        throw new Error(`추가 관리자(${lid})는 최초 등록 시 비밀번호를 입력해야 합니다.`);
      }
    }
  }
  return result;
}
