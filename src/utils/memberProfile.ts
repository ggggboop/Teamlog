import type { TeamMember } from '@/types/workLog';

/** 팀원 목록 한 줄·다이얼로그에 맞춘 상태메시지 최대 글자수 */
export const MEMBER_STATUS_MESSAGE_MAX = 20;

const STORAGE_PREFIX = 'teamlog_profile_seen_v1:';

export function memberProfileSignature(m: Pick<TeamMember, 'avatar' | 'statusMessage'>): string {
  const av = (m.avatar ?? '').trim();
  const st = (m.statusMessage ?? '').trim();
  return `${av}\u001f${st}`;
}

function parseBaseline(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, string>;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/**
 * "마지막으로 팀원 목록을 닫았을 때" 본 프로필 서명을 팀별로 저장합니다.
 * `localStorage`를 써서 계정을 바꿔 로그인해도 이전에 본 상태와 비교할 수 있습니다.
 * (예전 구현의 sessionStorage 값은 한 번 읽어 옮깁니다.)
 */
export function readProfileBaseline(teamId: string): Record<string, string> {
  if (!teamId || typeof window === 'undefined') return {};
  const key = `${STORAGE_PREFIX}${teamId}`;
  try {
    const fromLs = localStorage.getItem(key);
    if (fromLs != null) return parseBaseline(fromLs);
    const fromSs = sessionStorage.getItem(key);
    if (fromSs != null) {
      localStorage.setItem(key, fromSs);
      sessionStorage.removeItem(key);
      return parseBaseline(fromSs);
    }
  } catch {
    /* private mode 등 */
  }
  return {};
}

function writeProfileBaseline(teamId: string, map: Record<string, string>): void {
  if (!teamId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${teamId}`, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

/** 팝오버를 닫을 때: 목록을 본 것으로 간주하고 현재 프로필로 스냅샷을 맞춥니다. */
export function mergeProfileBaselineWithMembers(teamId: string, members: TeamMember[]): void {
  if (!teamId) return;
  const cur = readProfileBaseline(teamId);
  for (const m of members) {
    cur[m.id] = memberProfileSignature(m);
  }
  writeProfileBaseline(teamId, cur);
}

/** 본인이 프로필 저장 직후, 자기 행에 노란 점이 남지 않도록 합니다. */
export function recordMemberProfileSeen(
  teamId: string,
  memberId: string,
  patch: Pick<TeamMember, 'avatar' | 'statusMessage'>
): void {
  if (!teamId) return;
  const cur = readProfileBaseline(teamId);
  cur[memberId] = memberProfileSignature(patch);
  writeProfileBaseline(teamId, cur);
}

export function memberHasProfilePing(
  baseline: Record<string, string>,
  member: TeamMember
): boolean {
  const sig = memberProfileSignature(member);
  const prev = baseline[member.id];
  if (prev === undefined) return false;
  return prev !== sig;
}

/** 작성자 화면: 팀원 목록 중 한 명이라도 프로필 변경이 반영되지 않은 상태면 true */
export function teamHasAnyProfilePing(
  baseline: Record<string, string>,
  members: TeamMember[]
): boolean {
  return members.some((m) => memberHasProfilePing(baseline, m));
}
