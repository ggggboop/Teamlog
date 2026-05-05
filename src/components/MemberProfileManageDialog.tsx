import { useEffect, useState } from 'react';
import { MEMBER_EMOJI_PALETTE } from '@/constants/memberEmojiPalette';
import { MEMBER_STATUS_MESSAGE_MAX } from '@/utils/memberProfile';
import type { TeamMember } from '@/types/workLog';
import { MemberEmojiBubble } from '@/components/MemberEmojiBubble';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface MemberProfileManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember | null;
  onSave: (updates: { avatar: string; statusMessage: string }) => void | Promise<void>;
}

export function MemberProfileManageDialog({
  open,
  onOpenChange,
  member,
  onSave,
}: MemberProfileManageDialogProps) {
  const [draftEmoji, setDraftEmoji] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !member) return;
    const raw = (member.avatar ?? '').trim();
    setDraftEmoji(raw || '');
    setDraftStatus((member.statusMessage ?? '').trim().slice(0, MEMBER_STATUS_MESSAGE_MAX));
  }, [open, member]);

  const previewMember: TeamMember | null = member
    ? { ...member, avatar: draftEmoji || undefined, statusMessage: draftStatus || undefined }
    : null;

  const handleSave = () => {
    if (!member || saving) return;
    setSaving(true);
    void (async () => {
      try {
        await Promise.resolve(
          onSave({
            avatar: draftEmoji.trim(),
            statusMessage: draftStatus.trim(),
          })
        );
        onOpenChange(false);
      } catch {
        /* 부모에서 토스트 */
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[42rem] w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>프로필 관리</DialogTitle>
          <DialogDescription>
            {member ? `「${member.name}」` : '팀원'}의 프로필 이모지와 상태메시지를 설정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex items-center gap-3">
            <MemberEmojiBubble member={previewMember} />
            <p className="text-xs text-muted-foreground">아래에서 이모지를 고르면 미리 보입니다.</p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground">프로필 이모지</p>
            <div className="grid grid-cols-8 gap-2 max-h-[min(40vh,260px)] overflow-y-auto pr-1">
              {MEMBER_EMOJI_PALETTE.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={
                    draftEmoji === emoji
                      ? 'flex h-11 w-11 items-center justify-center rounded-xl border-2 border-primary bg-primary/5 text-xl leading-none'
                      : 'flex h-11 w-11 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-xl leading-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
                  }
                  aria-label={`이모지 ${emoji}`}
                  onClick={() => setDraftEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="member-status-msg" className="text-xs font-medium text-foreground">
                상태메시지
              </label>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {draftStatus.length}/{MEMBER_STATUS_MESSAGE_MAX}
              </span>
            </div>
            <textarea
              id="member-status-msg"
              value={draftStatus}
              maxLength={MEMBER_STATUS_MESSAGE_MAX}
              onChange={(e) => setDraftStatus(e.target.value.slice(0, MEMBER_STATUS_MESSAGE_MAX))}
              placeholder="한 줄로 짧게 적어 주세요"
              rows={2}
              className="worklog-form-control w-full resize-none text-sm min-h-[3rem]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button type="button" onClick={handleSave} disabled={!member || saving}>
            {saving ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
