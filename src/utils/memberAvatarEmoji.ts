import type { TeamMember } from '@/types/workLog';

/** 설정 없을 때 원 안에 넣을 기본 이모지 */
export const MEMBER_EMOJI_FALLBACK = '🙂';

/**
 * `TeamMember.avatar`에 저장된 표시용 이모지(보통 1개).
 * 복합 이모지면 첫 그라페므 클러스터만 사용합니다.
 */
export function getMemberEmoji(member: TeamMember | null | undefined): string {
  if (!member) return MEMBER_EMOJI_FALLBACK;
  const raw = (member.avatar ?? '').trim();
  if (!raw) return MEMBER_EMOJI_FALLBACK;
  try {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const first = [...seg.segment(raw)][0]?.segment;
    return first?.trim() || MEMBER_EMOJI_FALLBACK;
  } catch {
    return raw.slice(0, 2) || MEMBER_EMOJI_FALLBACK;
  }
}
