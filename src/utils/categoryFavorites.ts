import type { Category } from '@/types/workLog';
import type { StoredSessionRole } from '@/utils/sessionKeys';

function storageKey(teamId: string, authorScope: string): string {
  return `teamlog:categoryFavorites:${teamId}:${authorScope}`;
}

/**
 * 로그인 역할·사번 기준 localStorage 스코프 (팀+작성자별 즐겨찾기).
 * 작성자(writer)는 사번 필수 — 없으면 null(메뉴 비표시).
 */
export function categoryFavoritesAuthorScope(
  sessionRole: StoredSessionRole | null,
  teamId: string | null | undefined,
  lastLoginEmployee: string | null | undefined
): string | null {
  const emp = (lastLoginEmployee ?? '').trim();
  if (!teamId || !sessionRole) return null;
  if (sessionRole === 'writer') {
    if (!emp) return null;
    return `w:${emp}`;
  }
  if (sessionRole === 'admin') {
    if (emp) return `a:${emp}`;
    return `a:notie:${teamId}`;
  }
  if (sessionRole === 'master') {
    if (emp) return `m:${emp}`;
    return 'm:global';
  }
  return null;
}

export function readCategoryFavorites(
  teamId: string | null | undefined,
  authorScope: string | null | undefined
): string[] {
  if (!teamId || !authorScope) return [];
  try {
    const raw = localStorage.getItem(storageKey(teamId, authorScope));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

export function writeCategoryFavorites(
  teamId: string,
  authorScope: string,
  keys: string[]
): void {
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  localStorage.setItem(storageKey(teamId, authorScope), JSON.stringify(unique));
}

export function clearCategoryFavorites(teamId: string | null | undefined, authorScope: string | null | undefined): void {
  if (!teamId || !authorScope) return;
  localStorage.removeItem(storageKey(teamId, authorScope));
}

/** 즐겨찾기 토글 후 최신 목록 반환 */
export function toggleCategoryFavorite(
  teamId: string,
  authorScope: string,
  categoryKey: string
): string[] {
  const k = categoryKey.trim();
  if (!k) return readCategoryFavorites(teamId, authorScope);
  const cur = readCategoryFavorites(teamId, authorScope);
  const i = cur.indexOf(k);
  if (i >= 0) {
    cur.splice(i, 1);
  } else {
    cur.push(k);
  }
  writeCategoryFavorites(teamId, authorScope, cur);
  return cur;
}

/** 트리에 없는 즐겨찾기 문자열 제거 (표시·선택 목록과 동기) */
export function filterValidFavorites(keys: string[], categoriesTree: Category[]): string[] {
  if (!categoriesTree.length) return [];
  const normalized = categoriesTree.map((c) => ({
    ...c,
    id: Number(c.id),
    parentId: c.parentId != null ? Number(c.parentId) : null,
  }));
  const majors = normalized.filter((c) => c.parentId == null);
  const subsByParent = new Map<number, Category[]>();
  normalized
    .filter((c) => c.parentId != null)
    .forEach((c) => {
      const pid = c.parentId!;
      const arr = subsByParent.get(pid) || [];
      arr.push(c);
      subsByParent.set(pid, arr);
    });
  const valid = new Set<string>();
  for (const m of majors) {
    valid.add(m.name.trim());
    const subs = subsByParent.get(m.id) || [];
    for (const s of subs) {
      valid.add(`${m.name} > ${s.name}`.trim());
    }
  }
  return keys.filter((key) => valid.has(key.trim()));
}
