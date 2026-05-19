import { useState, useMemo } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkTeam } from '@/types/workLog';
import type { GlobalTeamAdminPreview } from '@/constants/globalTeamAdmin';
import { GLOBAL_TEAM_ADMIN_SCOPE_ID } from '@/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';
import { getLastLoginEmployee } from '@/utils/sessionKeys';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PasswordInputWithToggle } from '@/components/PasswordInputWithToggle';

interface AdminPasswordSettingsTabProps {
  selectedTeamId: string | null;
  teams: WorkTeam[];
  globalTeamAdminPreview: GlobalTeamAdminPreview;
  onChangePassword: (params: ChangeAdminPasswordSelfParams) => Promise<void>;
  sessionRole?: 'admin' | 'director' | 'master' | 'writer' | null;
}

export function AdminPasswordSettingsTab({
  selectedTeamId,
  teams: teamsProp,
  globalTeamAdminPreview: gpProp,
  onChangePassword,
  sessionRole,
}: AdminPasswordSettingsTabProps) {
  const teams = teamsProp ?? [];
  const globalTeamAdminPreview = gpProp ?? { adminLoginId: null as string | null, hasPassword: false };

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  /** 팀·전체팀 관리자 전용 (마스터 계정은 마스터 관리 화면에서 다룸) */
  const { mode, teamId, loginIdDisplay, scopeLabel, sessionLoginId, canChange } = useMemo(() => {
    const session = (getLastLoginEmployee() ?? '').trim();
    if (sessionRole === 'director' || selectedTeamId === GLOBAL_TEAM_ADMIN_SCOPE_ID) {
      const primary = (globalTeamAdminPreview.adminLoginId ?? '').trim();
      const extraOk = (globalTeamAdminPreview.extraAccounts ?? []).some(
        (e) => (e.loginId ?? '').trim() === session && e.hasPassword
      );
      const ok = session && (session === primary || extraOk);
      return {
        mode: 'global' as const,
        teamId: undefined as string | undefined,
        loginIdDisplay: ok ? session : primary || null,
        scopeLabel: 'Director',
        sessionLoginId: session,
        canChange: !!ok,
      };
    }
    const t = teams.find((x) => x.id === selectedTeamId);
    const primary = (t?.adminLoginId ?? '').trim();
    const extraOk = (t?.extraAdminAccounts ?? []).some(
      (e) => (e.loginId ?? '').trim() === session && e.hasPassword
    );
    const ok = session && (session === primary || extraOk);
    return {
      mode: 'team' as const,
      teamId: selectedTeamId ?? undefined,
      loginIdDisplay: ok ? session : primary || null,
      scopeLabel: t ? `${t.name} Manager` : 'Manager',
      sessionLoginId: session,
      canChange: !!ok,
    };
  }, [selectedTeamId, teams, globalTeamAdminPreview, sessionRole]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canChange) return;
    if (next !== confirm) {
      toast.error('새 비밀번호와 확인이 일치하지 않습니다.');
      return;
    }
    if (!next.length) {
      toast.error('새 비밀번호를 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      let params: ChangeAdminPasswordSelfParams;
      if (mode === 'global') {
        params = {
          scope: 'global',
          adminLoginId: sessionLoginId || undefined,
          currentPassword: current,
          newPassword: next,
        };
      } else {
        if (!teamId) throw new Error('팀이 선택되지 않았습니다.');
        params = {
          scope: 'team',
          teamId,
          adminLoginId: sessionLoginId || undefined,
          currentPassword: current,
          newPassword: next,
        };
      }
      await onChangePassword(params);
      toast.success('비밀번호가 변경되었습니다.');
      setCurrent('');
      /** 새·확인란에는 방금 설정한 비밀번호를 그대로 둠(가리기 기본, 눈 아이콘으로 확인) */
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="worklog-topbar shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#1e293b]">관리자 설정</h2>
            <p className="text-sm text-muted-foreground">
              {scopeLabel} 계정의 비밀번호를 변경합니다. 관리자 사번은 Master만 등록·변경할 수 있습니다.
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-6 max-w-md w-full">
        <div className="worklog-day-card p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-[#64748b]">관리자 사번 (읽기 전용)</label>
            <Input
              readOnly
              value={loginIdDisplay ?? ''}
              placeholder="미등록"
              className="mt-1.5 h-10 rounded-xl bg-muted/40 text-[#1e293b]"
            />
          </div>

          {!canChange ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2">
              Master 관리에서 관리자 사번이 등록된 뒤 비밀번호를 변경할 수 있습니다.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#64748b]">현재 비밀번호</label>
                <div className="mt-1.5">
                  <PasswordInputWithToggle
                    value={current}
                    onChange={setCurrent}
                    inputClassName="h-10 rounded-xl"
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[#64748b]">새 비밀번호</label>
                <div className="mt-1.5">
                  <PasswordInputWithToggle
                    value={next}
                    onChange={setNext}
                    inputClassName="h-10 rounded-xl"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[#64748b]">새 비밀번호 확인</label>
                <div className="mt-1.5">
                  <PasswordInputWithToggle
                    value={confirm}
                    onChange={setConfirm}
                    inputClassName="h-10 rounded-xl"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <Button type="submit" className="w-full rounded-xl" disabled={loading}>
                {loading ? '처리 중…' : '비밀번호 변경'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
