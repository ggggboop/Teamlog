import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { TeamMember, WorkTeam } from '@/types/workLog';
import type { GlobalTeamAdminPreview } from '@/constants/globalTeamAdmin';
import { GLOBAL_TEAM_ADMIN_SCOPE_ID } from '@/constants/globalTeamAdmin';
import { dataService, initializeDataService } from '@/services/DataService';
import { toast } from 'sonner';
import type { StoredSessionRole } from '@/utils/sessionKeys';
import { getLastLoginEmployee, setLastLoginEmployee } from '@/utils/sessionKeys';
import {
  SpatialLineageViewport,
  type SpatialLineageViewportHandle,
  type LoginActionsBridge,
} from '@/components/spatial-login/SpatialLineageViewport';
import '@/components/spatial-login/spatial-login.css';
import { LoginFormPanel } from '@/components/LoginFormPanel';
import { TeamlogBrand } from '@/components/TeamlogBrand';
import { DbPathSection } from '@/components/DbPathSection';
import { cn } from '@/lib/utils';

type PendingAdmin =
  | { kind: 'master' }
  | { kind: 'global' }
  | { kind: 'team'; teamId: string };

interface LoginScreenProps {
  teams: WorkTeam[];
  loading: boolean;
  globalTeamAdminPreview: GlobalTeamAdminPreview;
  masterLoginPreview: { loginId: string | null };
  verifyTeamAdmin: (teamId: string, loginId: string, password: string) => Promise<boolean>;
  verifyMasterLogin: (loginId: string, password: string) => Promise<boolean>;
  onWriterComplete: (member: TeamMember) => void;
  onAdminComplete: (payload: { teamId: string; role: Extract<StoredSessionRole, 'admin' | 'director' | 'master'> }) => void;
}

const norm = (s: string | null | undefined) => (s ?? '').trim();

export function LoginScreen({
  teams,
  loading,
  globalTeamAdminPreview,
  masterLoginPreview,
  verifyTeamAdmin,
  verifyMasterLogin,
  onWriterComplete,
  onAdminComplete,
}: LoginScreenProps) {
  const viewportRef = useRef<SpatialLineageViewportHandle>(null);
  const loginBridgeRef = useRef<LoginActionsBridge>({
    onOpenFullForm: () => {},
  });
  const backRef = useRef<() => void>(() => {});

  const [showForm, setShowForm] = useState(false);

  const [employeeNo, setEmployeeNo] = useState(() => getLastLoginEmployee() ?? '');
  const [password, setPassword] = useState('');
  const [adminPhase, setAdminPhase] = useState<'idle' | 'need_password'>('idle');
  const [pendingAdmin, setPendingAdmin] = useState<PendingAdmin | null>(null);
  const [busy, setBusy] = useState(false);
  const [dbPathDialogOpen, setDbPathDialogOpen] = useState(false);
  const [dbAuthDialogOpen, setDbAuthDialogOpen] = useState(false);
  const [dbAuthId, setDbAuthId] = useState('');
  const [dbAuthPassword, setDbAuthPassword] = useState('');
  const [dbAuthBusy, setDbAuthBusy] = useState(false);

  const handleDbAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dbAuthId.trim()) return toast.error('사번을 입력해주세요.');
    setDbAuthBusy(true);
    try {
      await initializeDataService();
      const ok = await verifyMasterLogin(dbAuthId, dbAuthPassword);
      if (ok) {
        setDbAuthDialogOpen(false);
        setDbPathDialogOpen(true);
        setDbAuthPassword('');
      } else {
        toast.error('마스터 권한이 없습니다.');
      }
    } catch (err) {
      toast.error('오류가 발생했습니다.');
    } finally {
      setDbAuthBusy(false);
    }
  };

  useEffect(() => {
    setPassword('');
    setAdminPhase('idle');
    setPendingAdmin(null);
  }, [employeeNo]);

  const resolveEmployeeStep = async (idRaw: string) => {
    const id = norm(idRaw);
    if (!id) {
      toast.error('사번을 입력해 주세요.');
      return;
    }

    setBusy(true);
    try {
      await initializeDataService();
      const allMembers = await dataService.getMembers();

      if (norm(masterLoginPreview.loginId) === id) {
        const ok = await verifyMasterLogin(id, '');
        if (!ok) {
          toast.error('마스터 로그인에 실패했습니다.');
          return;
        }
        const firstTeamId = teams.find((t) => t.id !== GLOBAL_TEAM_ADMIN_SCOPE_ID)?.id;
        setLastLoginEmployee(id);
        onAdminComplete({ teamId: firstTeamId || GLOBAL_TEAM_ADMIN_SCOPE_ID, role: 'master' });
        return;
      }

      if (
        norm(globalTeamAdminPreview.adminLoginId) === id ||
        (globalTeamAdminPreview.extraAccounts ?? []).some((e) => norm(e.loginId) === id)
      ) {
        setPendingAdmin({ kind: 'global' });
        setAdminPhase('need_password');
        setEmployeeNo(id);
        setShowForm(true);
        return;
      }

      const team = teams.find(
        (t) =>
          t.id !== GLOBAL_TEAM_ADMIN_SCOPE_ID &&
          (norm(t.adminLoginId) === id || (t.extraAdminAccounts ?? []).some((e) => norm(e.loginId) === id))
      );
      if (team) {
        setPendingAdmin({ kind: 'team', teamId: team.id });
        setAdminPhase('need_password');
        setEmployeeNo(id);
        setShowForm(true);
        return;
      }

      const member = allMembers.find((m) => norm(m.employeeNo) === id);
      if (member) {
        setLastLoginEmployee(id);
        onWriterComplete(member);
        return;
      }

      toast.error('등록되지 않은 사번입니다.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordStep = async () => {
    if (!pendingAdmin) return;
    const id = norm(employeeNo);
    const pw = password;
    if (!pw) {
      toast.error('비밀번호를 입력해 주세요.');
      return;
    }

    setBusy(true);
    try {
      if (pendingAdmin.kind === 'master') {
        const ok = await verifyMasterLogin(id, pw);
        if (!ok) {
          toast.error('비밀번호가 맞지 않습니다.');
          return;
        }
        const firstTeamId = teams.find((t) => t.id !== GLOBAL_TEAM_ADMIN_SCOPE_ID)?.id;
        setLastLoginEmployee(id);
        onAdminComplete({ teamId: firstTeamId || GLOBAL_TEAM_ADMIN_SCOPE_ID, role: 'master' });
        return;
      }

      if (pendingAdmin.kind === 'global') {
        const ok = await verifyTeamAdmin(GLOBAL_TEAM_ADMIN_SCOPE_ID, id, pw);
        if (!ok) {
          toast.error('비밀번호가 맞지 않습니다.');
          return;
        }
        const firstTeamId = teams.find((t) => t.id !== GLOBAL_TEAM_ADMIN_SCOPE_ID)?.id;
        setLastLoginEmployee(id);
        onAdminComplete({ teamId: firstTeamId || GLOBAL_TEAM_ADMIN_SCOPE_ID, role: 'director' });
        return;
      }

      const ok = await verifyTeamAdmin(pendingAdmin.teamId, id, pw);
      if (!ok) {
        toast.error('비밀번호가 맞지 않습니다.');
        return;
      }
      setLastLoginEmployee(id);
      onAdminComplete({ teamId: pendingAdmin.teamId, role: 'admin' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || busy) return;
    if (adminPhase === 'need_password' && pendingAdmin) {
      await handlePasswordStep();
    } else {
      await resolveEmployeeStep(employeeNo);
    }
  };

  const handleOpenFullForm = () => {
    setEmployeeNo(getLastLoginEmployee() ?? '');
    setPassword('');
    setAdminPhase('idle');
    setPendingAdmin(null);
    setShowForm(true);
  };

  const handleBackToScene = () => {
    setShowForm(false);
    setEmployeeNo('');
    setPassword('');
    setAdminPhase('idle');
    setPendingAdmin(null);
  };

  backRef.current = handleBackToScene;

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') backRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  useEffect(() => {
    if (!dbPathDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDbPathDialogOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dbPathDialogOpen]);

  loginBridgeRef.current = {
    onOpenFullForm: handleOpenFullForm,
  };

  return (
    <div className="spatial-login-root relative min-h-[100dvh] w-full overflow-hidden bg-[#f2f4f8]">
      {/*
        원소표 전체(3D + UI)를 한 레이어로 전체 화면(inset-0)에 깔고,
        로그인 시 이 레이어만 통째로 왼쪽으로 이동 — 오른쪽은 레이아웃 ‘섹션’이 아니라 빈 배경 위에 팝업만 올림
      */}
      <div
        className={cn(
          'absolute inset-0 transition-transform duration-500 ease-out will-change-transform',
          (showForm || dbPathDialogOpen) &&
            '-translate-x-[min(11vw,100px)] sm:-translate-x-[min(14vw,140px)] md:-translate-x-[min(18vw,220px)]'
        )}
      >
        <SpatialLineageViewport
          ref={viewportRef}
          loginBridgeRef={loginBridgeRef}
          loginOverlayActive={showForm}
        />

        <div className="sl-ui-layer">
          <header className="sl-header">
            <TeamlogBrand className="mb-0" />
            <button type="button" className="sl-btn" onClick={() => setDbAuthDialogOpen(true)}>
              PostgreSQL 연결 설정
            </button>
          </header>
          <div className="sl-instructions">
            DK에 마우스를 올려 로그인 · 최초 설치 시 PostgreSQL 연결을 먼저 설정하세요.
          </div>
        </div>
      </div>

      {showForm && (
        <>
          {/* 배경 어둡게 하지 않음 — 바깥 클릭만 닫기 */}
          <div
            className="fixed inset-0 z-[1100] bg-transparent"
            aria-hidden
            onClick={handleBackToScene}
          />
          <div
            className={cn(
              'fixed left-1/2 top-1/2 z-[1110] w-[min(calc(100vw-1.75rem),440px)] max-h-[min(90dvh,880px)]',
              /* 좁은 화면: 중앙(잘림 방지) · md↑: 가로 75% 지점에 카드 중심 — DK 로그인 버튼으로 열리는 폼만 슬라이드 인 */
              '-translate-x-1/2 -translate-y-1/2 md:left-[75%] overflow-hidden rounded-2xl border border-slate-200/90 bg-white',
              'shadow-[0_24px_64px_-16px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(15,23,42,0.08)]',
              'animate-in fade-in slide-in-from-right-12 duration-300 ease-out'
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-popup-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/90 px-4 py-3">
              <h2 id="login-popup-title" className="text-[15px] font-semibold tracking-tight text-slate-800">
                로그인
              </h2>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-900"
                onClick={handleBackToScene}
                aria-label="닫기"
              >
                <X className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
            <div className="max-h-[calc(min(90dvh,880px)-52px)] overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
              <LoginFormPanel
                variant="embedded"
                loading={loading}
                busy={busy}
                employeeNo={employeeNo}
                password={password}
                adminPhase={adminPhase}
                onEmployeeNoChange={setEmployeeNo}
                onPasswordChange={setPassword}
                onSubmit={onSubmit}
              />
            </div>
          </div>
        </>
      )}

      {dbAuthDialogOpen && (
        <>
          <div
            className="fixed inset-0 z-[1100] bg-transparent"
            aria-hidden
            onClick={() => setDbAuthDialogOpen(false)}
          />
          <div
            className={cn(
              'fixed left-1/2 top-1/2 z-[1110] w-[min(calc(100vw-1.75rem),380px)]',
              '-translate-x-1/2 -translate-y-1/2 md:left-[75%] overflow-hidden rounded-2xl border border-slate-200/90 bg-white',
              'shadow-[0_24px_64px_-16px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(15,23,42,0.08)]',
              'animate-in fade-in slide-in-from-right-12 duration-300 ease-out'
            )}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/90 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-800">
                연결 설정 접근 권한 확인
              </h2>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-900"
                onClick={() => setDbAuthDialogOpen(false)}
              >
                <X className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
            <div className="px-5 pb-6 pt-5">
              <form onSubmit={handleDbAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">마스터 로그인 ID</label>
                  <input
                    type="text"
                    value={dbAuthId}
                    onChange={(e) => setDbAuthId(e.target.value)}
                    placeholder="사번 입력"
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
                  <input
                    type="password"
                    value={dbAuthPassword}
                    onChange={(e) => setDbAuthPassword(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={dbAuthBusy}
                  className="w-full inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-slate-50 hover:bg-slate-900/90 disabled:opacity-50"
                >
                  {dbAuthBusy ? '확인 중...' : '확인'}
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      {dbPathDialogOpen && (
        <>
          <div
            className="fixed inset-0 z-[1100] bg-transparent"
            aria-hidden
            onClick={() => setDbPathDialogOpen(false)}
          />
          <div
            className={cn(
              'fixed left-1/2 top-1/2 z-[1110] w-[min(calc(100vw-1.75rem),440px)] max-h-[min(90dvh,880px)]',
              '-translate-x-1/2 -translate-y-1/2 md:left-[75%] overflow-hidden rounded-2xl border border-slate-200/90 bg-white',
              'shadow-[0_24px_64px_-16px_rgba(15,23,42,0.18),0_8px_24px_-8px_rgba(15,23,42,0.08)]',
              'animate-in fade-in slide-in-from-right-12 duration-300 ease-out'
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="db-path-popup-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/90 px-4 py-3">
              <h2 id="db-path-popup-title" className="text-[15px] font-semibold tracking-tight text-slate-800">
                PostgreSQL 연결 설정
              </h2>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-900"
                onClick={() => setDbPathDialogOpen(false)}
                aria-label="닫기"
              >
                <X className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
            <div className="max-h-[calc(min(90dvh,880px)-52px)] overflow-y-auto overscroll-contain px-5 pb-6 pt-5">
              <DbPathSection active={dbPathDialogOpen} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
