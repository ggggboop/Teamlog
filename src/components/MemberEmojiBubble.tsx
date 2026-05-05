import type { TeamMember } from '@/types/workLog';
import { getMemberEmoji } from '@/utils/memberAvatarEmoji';
import { cn } from '@/lib/utils';

interface MemberEmojiBubbleProps {
  member: TeamMember | null;
  className?: string;
  /** 원 크기: sm(목록용) = 2rem, md(트리거) = 2.25rem */
  size?: 'sm' | 'md';
}

export function MemberEmojiBubble({ member, className, size = 'md' }: MemberEmojiBubbleProps) {
  const emoji = getMemberEmoji(member);
  const sizeCls =
    size === 'sm'
      ? 'h-8 w-8 min-h-8 min-w-8 text-[1.12rem]'
      : 'h-9 w-9 min-h-9 min-w-9 text-[1.38rem]';
  return (
    <div
      className={cn(
        'rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden bg-white shadow-sm ring-1 ring-black/[0.08]',
        sizeCls,
        className
      )}
      aria-hidden
    >
      <span className="select-none flex items-center justify-center leading-none [line-height:1]">
        {emoji}
      </span>
    </div>
  );
}
