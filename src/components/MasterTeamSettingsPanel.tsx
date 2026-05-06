import { useState, useEffect, useMemo } from 'react';
import { Trash2, Plus, Shield, ShieldAlert, Users, UserCog, Calendar, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { WorkTeam } from '@/types/workLog';
import type {
  AdminExtraAccountPayload,
  GlobalTeamAdminPreview,
  GlobalTeamAdminSavePayload,
} from '@/constants/globalTeamAdmin';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PasswordInputWithToggle } from '@/components/PasswordInputWithToggle';
import { loadMasterPanelPasswordCache, mergeMasterPanelPasswordCache } from '@/utils/masterPanelPasswordCache';
import { cn } from '@/lib/utils';
import { dataService } from '@/services/DataService';
import { MIN_REQUIRED_VERSION_SETTING_KEY } from '@/constants/versionPolicy';
import { APP_VERSION } from '@/constants/appVersion';

interface TeamDraft {
  id: string;
  name: string;
  sortOrder: number;
}

interface AdminRowEntry {
  rowKey: string;
  teamId: string;
  isPrimary: boolean;
  adminLoginId: string;
  passwordPlain: string;
  /** DB에 비밀번호 해시가 있음(화면에는 비우고 안내만) */
  hasStoredPassword?: boolean;
}

interface GlobalAdminRow {
  rowKey: string;
  isPrimary: boolean;
  adminLoginId: string;
  passwordPlain: string;
  hasStoredPassword?: boolean;
}

interface MasterTeamSettingsPanelProps {
  teams: WorkTeam[];
  globalTeamAdminPreview: GlobalTeamAdminPreview;
  /** 저장된 값 `yyyy-MM-dd` 또는 null — 이 날짜부터 업무 기록 작성 가능 */
  workRecordStartDate: string | null;
  onSave: (payload: {
    teams: Array<{
      id: string;
      name: string;
      sortOrder: number;
      adminLoginId: string;
      passwordPlain?: string | null;
      extraAdmins?: AdminExtraAccountPayload[];
    }>;
    deletedTeamIds: string[];
    globalTeamAdmin?: GlobalTeamAdminSavePayload;
    workRecordStartDate?: string | null;
  }) => Promise<void>;
  /** 샘플 팀원·로그 적용 (관리자·팀 설정은 유지) */
  onGenerateSampleData?: () => Promise<void>;
  /** 팀원·업무 기록만 삭제 (팀·관리자·앱 설정 유지) */
  onResetOperationalData?: () => Promise<void>;
}

function toTeamDrafts(teams: WorkTeam[]): TeamDraft[] {
  return [...teams]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
    }));
}

function buildAdminEntries(teams: WorkTeam[]): AdminRowEntry[] {
  const sorted = [...teams].sort((a, b) => a.sortOrder - b.sortOrder);
  const out: AdminRowEntry[] = [];
  for (const t of sorted) {
    out.push({
      rowKey: `p-${t.id}`,
      teamId: t.id,
      isPrimary: true,
      adminLoginId: t.adminLoginId ?? '',
      passwordPlain: '',
      hasStoredPassword: !!t.hasAdminPassword,
    });
    let i = 0;
    for (const ex of t.extraAdminAccounts ?? []) {
      out.push({
        rowKey: `e-${t.id}-${ex.loginId ?? i}`,
        teamId: t.id,
        isPrimary: false,
        adminLoginId: ex.loginId ?? '',
        passwordPlain: '',
        hasStoredPassword: ex.hasPassword,
      });
      i += 1;
    }
  }
  return out;
}

/** DB에 비밀번호만 있고 이 브라우저 캐시가 없을 때 빈 칸 대신 표시(실제 비밀번호 아님) */
const MASTER_ADMIN_PASSWORD_MASK = '••••••••';

function masterAdminPasswordDisplayValue(
  passwordPlain: string,
  rowKey: string,
  committed: Record<string, string>,
  hasStoredPassword?: boolean
): string {
  const fromCommitted = committed[rowKey]?.trim();
  const plain = passwordPlain.trim();
  if (plain) return passwordPlain;
  if (fromCommitted) return committed[rowKey] ?? '';
  if (hasStoredPassword) return MASTER_ADMIN_PASSWORD_MASK;
  return '';
}

function buildGlobalRows(gp: GlobalTeamAdminPreview): GlobalAdminRow[] {
  const rows: GlobalAdminRow[] = [
    {
      rowKey: 'g-p',
      isPrimary: true,
      adminLoginId: gp.adminLoginId ?? '',
      passwordPlain: '',
      hasStoredPassword: gp.hasPassword,
    },
  ];
  let i = 0;
  for (const ex of gp.extraAccounts ?? []) {
    rows.push({
      rowKey: `g-${ex.loginId ?? i}`,
      isPrimary: false,
      adminLoginId: ex.loginId ?? '',
      passwordPlain: '',
      hasStoredPassword: ex.hasPassword,
    });
    i += 1;
  }
  return rows;
}

export function MasterTeamSettingsPanel({
  teams,
  globalTeamAdminPreview,
  workRecordStartDate,
  onSave,
  onGenerateSampleData,
  onResetOperationalData,
}: MasterTeamSettingsPanelProps) {
  const [teamDrafts, setTeamDrafts] = useState<TeamDraft[]>([]);
  const [adminRowEntries, setAdminRowEntries] = useState<AdminRowEntry[]>([]);
  const [globalRows, setGlobalRows] = useState<GlobalAdminRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [initialTeamIds, setInitialTeamIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [workRecordStartInput, setWorkRecordStartInput] = useState('');
  const [generatingSample, setGeneratingSample] = useState(false);
  const [showDataResetConfirm, setShowDataResetConfirm] = useState(false);
  /** 입력란 표시용 평문(서버는 해시만 보관). 저장 시 localStorage에도 넣어 재로그인 후에도 복원합니다. */
  const [committedPlainByRow, setCommittedPlainByRow] = useState<Record<string, string>>({});
  /** DB `min_required_version` — 이 버전 미만 클라이언트는 다음 실행부터 차단 */
  const [minRequiredVersionInput, setMinRequiredVersionInput] = useState('');
  const [minReqSaving, setMinReqSaving] = useState(false);

  const globalPreviewKey = useMemo(
    () =>
      JSON.stringify({
        a: globalTeamAdminPreview.adminLoginId,
        ex: (globalTeamAdminPreview.extraAccounts ?? []).map((e) => [e.loginId, e.hasPassword]),
      }),
    [globalTeamAdminPreview.adminLoginId, globalTeamAdminPreview.extraAccounts]
  );

  useEffect(() => {
    setTeamDrafts(toTeamDrafts(teams));
    setAdminRowEntries(buildAdminEntries(teams));
    setDeletedIds(new Set());
    setInitialTeamIds(new Set(teams.map((t) => t.id)));
    setError('');
  }, [teams]);

  useEffect(() => {
    setGlobalRows(buildGlobalRows(globalTeamAdminPreview));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- globalPreviewKey으로 서버 동기화 시점만 갱신
  }, [globalPreviewKey]);

  /** 팀·전체팀 관리자 행이 바뀔 때 localStorage 캐시를 입력란 상태로 복원 */
  const masterPanelHydrateKey = useMemo(
    () =>
      `${globalPreviewKey}||${[...teams]
        .map((t) => {
          const ex = (t.extraAdminAccounts ?? [])
            .map((e) => `${e.loginId ?? ''}:${e.hasPassword ? 1 : 0}`)
            .join(';');
          return `${t.id}:${t.hasAdminPassword ? 1 : 0}:${ex}`;
        })
        .sort()
        .join('|')}`,
    [teams, globalPreviewKey]
  );

  useEffect(() => {
    const cache = loadMasterPanelPasswordCache();
    const serverEntries = buildAdminEntries(teams);
    const globals = buildGlobalRows(globalTeamAdminPreview);
    const baseKeys = new Set([...serverEntries.map((e) => e.rowKey), ...globals.map((r) => r.rowKey)]);
    setCommittedPlainByRow((prev) => {
      const next = { ...prev };
      for (const k of baseKeys) {
        if (cache[k]) next[k] = cache[k];
      }
      return next;
    });
  }, [masterPanelHydrateKey, teams, globalTeamAdminPreview]);

  useEffect(() => {
    setWorkRecordStartInput(workRecordStartDate ?? '');
  }, [workRecordStartDate]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await dataService.getSetting(MIN_REQUIRED_VERSION_SETTING_KEY);
        if (!cancelled) setMinRequiredVersionInput((raw ?? '').trim());
      } catch {
        if (!cancelled) setMinRequiredVersionInput('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nextSortOrder = useMemo(() => {
    if (teamDrafts.length === 0) return 1;
    return Math.max(...teamDrafts.map((d) => d.sortOrder), 0) + 1;
  }, [teamDrafts]);

  const addTeam = () => {
    const id = crypto.randomUUID();
    setTeamDrafts((prev) => [...prev, { id, name: '새 팀', sortOrder: nextSortOrder }]);
    setAdminRowEntries((prev) => [
      ...prev,
      { rowKey: `p-${id}`, teamId: id, isPrimary: true, adminLoginId: '', passwordPlain: '', hasStoredPassword: false },
    ]);
  };

  const removeTeam = (id: string) => {
    if (initialTeamIds.has(id)) {
      setDeletedIds((prev) => new Set(prev).add(id));
    }
    setTeamDrafts((prev) => prev.filter((d) => d.id !== id));
    setAdminRowEntries((prev) => prev.filter((r) => r.teamId !== id));
  };

  const updateTeamDraft = (id: string, patch: Partial<TeamDraft>) => {
    setTeamDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const updateAdminEntry = (rowKey: string, patch: Partial<AdminRowEntry>) => {
    setAdminRowEntries((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  };

  const addExtraTeamAdmin = (teamId: string) => {
    setAdminRowEntries((prev) => {
      let last = -1;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i].teamId === teamId) last = i;
      }
      if (last < 0) return prev;
      const next = [...prev];
      next.splice(last + 1, 0, {
        rowKey: `n-${crypto.randomUUID()}`,
        teamId,
        isPrimary: false,
        adminLoginId: '',
        passwordPlain: '',
        hasStoredPassword: false,
      });
      return next;
    });
  };

  const removeAdminEntry = (rowKey: string) => {
    setAdminRowEntries((prev) => prev.filter((r) => r.rowKey !== rowKey));
  };

  const updateGlobalRow = (rowKey: string, patch: Partial<GlobalAdminRow>) => {
    setGlobalRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  };

  const stripCommittedForRow = (rowKey: string) => {
    setCommittedPlainByRow((p) => {
      if (!p[rowKey]) return p;
      const n = { ...p };
      delete n[rowKey];
      return n;
    });
  };

  const setTeamPasswordField = (rowKey: string, value: string) => {
    stripCommittedForRow(rowKey);
    setAdminRowEntries((prev) => {
      const entry = prev.find((r) => r.rowKey === rowKey);
      let v = value;
      if (entry) {
        const plain = entry.passwordPlain.trim();
        if (v === MASTER_ADMIN_PASSWORD_MASK && !plain) v = '';
        else if (!plain && entry.hasStoredPassword && v.startsWith(MASTER_ADMIN_PASSWORD_MASK)) {
          v = v.slice(MASTER_ADMIN_PASSWORD_MASK.length);
        }
      }
      return prev.map((r) => (r.rowKey === rowKey ? { ...r, passwordPlain: v } : r));
    });
  };

  const setGlobalPasswordField = (rowKey: string, value: string) => {
    stripCommittedForRow(rowKey);
    setGlobalRows((prev) => {
      const row = prev.find((r) => r.rowKey === rowKey);
      let v = value;
      if (row) {
        const plain = row.passwordPlain.trim();
        if (v === MASTER_ADMIN_PASSWORD_MASK && !plain) v = '';
        else if (!plain && row.hasStoredPassword && v.startsWith(MASTER_ADMIN_PASSWORD_MASK)) {
          v = v.slice(MASTER_ADMIN_PASSWORD_MASK.length);
        }
      }
      return prev.map((r) => (r.rowKey === rowKey ? { ...r, passwordPlain: v } : r));
    });
  };

  const addGlobalExtra = () => {
    setGlobalRows((prev) => [
      ...prev,
      {
        rowKey: `g-n-${crypto.randomUUID()}`,
        isPrimary: false,
        adminLoginId: '',
        passwordPlain: '',
        hasStoredPassword: false,
      },
    ]);
  };

  const removeGlobalRow = (rowKey: string) => {
    setGlobalRows((prev) => prev.filter((r) => r.rowKey !== rowKey));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const activeTeams = teamDrafts.filter((d) => !deletedIds.has(d.id));
      for (const d of activeTeams) {
        if (!d.name.trim()) {
          setError('팀 이름을 모두 입력해 주세요.');
          setSaving(false);
          return;
        }
      }

      const byTeam = new Map<string, AdminRowEntry[]>();
      for (const e of adminRowEntries) {
        if (!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
        byTeam.get(e.teamId)!.push(e);
      }

      const payloadTeams: Array<{
        id: string;
        name: string;
        sortOrder: number;
        adminLoginId: string;
        passwordPlain?: string | null;
        extraAdmins?: AdminExtraAccountPayload[];
      }> = [];

      for (const t of activeTeams) {
        const list = byTeam.get(t.id) ?? [];
        const primary = list.find((x) => x.isPrimary);
        const extras = list.filter((x) => !x.isPrimary);
        const pLogin = (primary?.adminLoginId ?? '').trim();
        const extraPayload: AdminExtraAccountPayload[] = extras.map((x) => ({
          adminLoginId: x.adminLoginId.trim(),
          passwordPlain: x.passwordPlain.trim() ? x.passwordPlain : undefined,
        }));
        const allIds = [pLogin, ...extraPayload.map((e) => e.adminLoginId)].filter(Boolean);
        if (new Set(allIds).size !== allIds.length) {
          setError('같은 팀 안에서 관리자 사번이 중복되었습니다.');
          setSaving(false);
          return;
        }
        payloadTeams.push({
          id: t.id,
          name: t.name.trim(),
          sortOrder: t.sortOrder,
          adminLoginId: pLogin,
          passwordPlain: primary?.passwordPlain?.trim() ? primary.passwordPlain : undefined,
          extraAdmins: extraPayload,
        });
      }

      const gPrimary = globalRows.find((r) => r.isPrimary);
      const gExtras = globalRows.filter((r) => !r.isPrimary);
      const gLogin = (gPrimary?.adminLoginId ?? '').trim();
      const rawGlobalPw = gPrimary?.passwordPlain ?? '';
      const gExtraPayload: AdminExtraAccountPayload[] = gExtras.map((x) => ({
        adminLoginId: x.adminLoginId.trim(),
        passwordPlain: x.passwordPlain.trim() ? x.passwordPlain : undefined,
      }));
      const gAllIds = [gLogin, ...gExtraPayload.map((e) => e.adminLoginId)].filter(Boolean);
      if (new Set(gAllIds).size !== gAllIds.length) {
        setError('전체팀 관리자 사번이 중복되었습니다.');
        setSaving(false);
        return;
      }

      const globalTeamAdmin: GlobalTeamAdminSavePayload = {
        adminLoginId: gLogin,
        passwordPlain: rawGlobalPw.trim() ? rawGlobalPw : undefined,
        extraAdmins: gExtraPayload,
      };

      const plainSnapshot: Record<string, string> = {};
      for (const e of adminRowEntries) {
        const t = e.passwordPlain.trim();
        if (t) plainSnapshot[e.rowKey] = t;
      }
      for (const r of globalRows) {
        const t = r.passwordPlain.trim();
        if (t) plainSnapshot[r.rowKey] = t;
      }

      await onSave({
        teams: payloadTeams,
        deletedTeamIds: Array.from(deletedIds),
        globalTeamAdmin,
        workRecordStartDate: workRecordStartInput.trim() || null,
      });
      if (Object.keys(plainSnapshot).length > 0) {
        mergeMasterPanelPasswordCache(plainSnapshot);
        setCommittedPlainByRow((p) => ({ ...p, ...plainSnapshot }));
      }
      setAdminRowEntries((prev) =>
        prev.map((e) => ({
          ...e,
          passwordPlain: '',
          hasStoredPassword: e.passwordPlain.trim() ? true : e.hasStoredPassword,
        }))
      );
      setGlobalRows((prev) =>
        prev.map((e) => ({
          ...e,
          passwordPlain: '',
          hasStoredPassword: e.passwordPlain.trim() ? true : e.hasStoredPassword,
        }))
      );
      toast.success('저장되었습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const sortedTeams = useMemo(
    () => [...teamDrafts].sort((a, b) => a.sortOrder - b.sortOrder),
    [teamDrafts]
  );

  return (
    <div className="h-full flex flex-col min-h-0 bg-transparent overflow-hidden worklog-admin-scope">
      <header className="worklog-topbar shrink-0 z-20">
        <div className="flex w-full min-w-0 items-center justify-between gap-4">
          <h2 className="shrink-0 text-xl font-semibold tracking-tight text-[#1e293b]">마스터 관리</h2>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="shrink-0 worklog-btn-primary py-1.5 text-base disabled:opacity-50"
          >
            {saving ? '저장 중…' : '변경 사항 저장'}
          </button>
        </div>
      </header>

      <div className="worklog-content-scroll space-y-6">
        <div className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-primary/[0.06] px-4 py-3 text-sm text-[#475569]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/80 shadow-sm ring-1 ring-black/[0.06]">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <p className="min-w-0 leading-relaxed pt-0.5">
            팀 이름·관리자 사번·비밀번호·시작일을 여기서 설정합니다.{' '}
            <strong className="font-medium text-[#1e293b]">저장</strong>을 눌러야 DB에 반영됩니다.
          </p>
        </div>

        <section className="worklog-day-card flex flex-col p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
              <Users className="w-5 h-5 text-primary shrink-0" />
              팀 설정
            </h3>
            <p className="text-xs text-[#64748b] mt-1.5 leading-relaxed">
              삭제한 팀의 팀원·기록은 저장 시 함께 정리됩니다.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-[#64748b] mb-2">팀 이름</p>
            <div className="rounded-xl border border-black/[0.08] bg-secondary/10 divide-y divide-border/60 overflow-hidden">
              {sortedTeams.length === 0 ? (
                <p className="px-3 py-6 text-sm text-muted-foreground text-center">
                  등록된 팀이 없습니다. 아래에서 추가하세요.
                </p>
              ) : (
                sortedTeams.map((team, index) => (
                  <div key={team.id} className="flex items-center gap-1.5 px-2 py-1.5 sm:px-3 bg-white/80">
                    <Input
                      value={team.name}
                      onChange={(e) => updateTeamDraft(team.id, { name: e.target.value })}
                      className="h-9 flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 rounded-lg px-2 text-base"
                      placeholder={`팀 ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => removeTeam(team.id)}
                      title="팀 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full rounded-xl border-dashed border-primary/35 py-2.5 text-primary hover:bg-primary/5"
            onClick={addTeam}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            팀 추가
          </Button>
        </section>

        <section className="worklog-day-card flex flex-col p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
              <Calendar className="w-5 h-5 text-primary shrink-0" />
              업무 기록 시작일
            </h3>
            <p className="text-xs text-[#64748b] mt-1.5 leading-relaxed">
              작성자 화면에서 <strong className="text-foreground">이 날짜 미만</strong> 일자에는 업무 행을 추가·수정·삭제할
              수 없습니다. 같은 날짜의 <strong className="text-foreground">연차·반차·연장</strong>은 그대로 저장할 수
              있습니다. 비워 두면 제한이 없습니다.
            </p>
          </div>
          <Input
            type="date"
            value={workRecordStartInput}
            onChange={(e) => setWorkRecordStartInput(e.target.value)}
            className="h-10 max-w-xs rounded-xl border-black/[0.08] text-base bg-white"
          />
          <p className="text-[11px] text-[#94a3b8]">
            예: 2026-04-02로 두면 4월 1일 및 이전에는 업무 기록만 막힙니다.
          </p>
        </section>

        <section className="worklog-day-card flex flex-col p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
              <ShieldAlert className="w-5 h-5 text-primary shrink-0" />
              필수 클라이언트 버전
            </h3>
            <p className="text-xs text-[#64748b] mt-1.5 leading-relaxed">
              공유 DB에 연결되는 <strong className="text-foreground">Electron 앱(package.json 버전)</strong>이 여기 적은
              버전보다 낮으면 다음 실행부터 로그인·업무 화면이 열리지 않습니다. IPC·무결성 정책 변경 시 마스터가 올린 최소 버전보다 오래된
              설치본을 차단합니다. 비우면 제한 없음.
            </p>
            <p className="text-[11px] text-[#94a3b8] mt-2">
              이 설치본 표시 버전: <span className="font-mono text-foreground">{APP_VERSION}</span>
            </p>
            <p className="text-xs text-amber-900/90 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 leading-relaxed dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              <strong>주의:</strong> 현재 설치본({APP_VERSION})보다 높은 최소 버전을 저장하면 이 PC에서도 앱이 시작되지 않을 수
              있습니다. 실수한 경우 DB의 <code className="font-mono text-[11px]">app_settings</code>에서 키{' '}
              <code className="font-mono text-[11px]">{MIN_REQUIRED_VERSION_SETTING_KEY}</code> 값을 비우거나 낮춘 뒤 다시
              시도하세요.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="예: 1.0.4"
              value={minRequiredVersionInput}
              onChange={(e) => setMinRequiredVersionInput(e.target.value)}
              className="h-10 max-w-[200px] rounded-xl border-black/[0.08] text-base font-mono bg-white"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-xl"
              disabled={minReqSaving}
              onClick={async () => {
                setMinReqSaving(true);
                try {
                  const trimmed = minRequiredVersionInput.trim();
                  await dataService.setSetting(MIN_REQUIRED_VERSION_SETTING_KEY, trimmed);
                  toast.success(
                    trimmed.length > 0
                      ? `최소 버전 ${trimmed} 저장됨 (이 버전 미만 앱 차단)`
                      : '최소 버전 요구를 해제했습니다.'
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : '저장에 실패했습니다.');
                } finally {
                  setMinReqSaving(false);
                }
              }}
            >
              {minReqSaving ? '저장 중…' : '저장'}
            </Button>
          </div>
        </section>

        <section className="worklog-day-card flex flex-col p-5 space-y-4 min-w-0">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
              <UserCog className="w-5 h-5 text-primary shrink-0" />
              관리자 설정
            </h3>
            <p className="text-xs text-[#64748b] mt-1.5 leading-relaxed">
              비밀번호는 <strong className="text-foreground">변경할 때만</strong> 입력합니다. 비워 두면 기존 비밀번호가 유지됩니다.
              <span className="text-foreground"> 추가 관리자</span>는 팀·전체팀마다 여러 명 둘 수 있습니다. 추가 시 최초 한 번은
              비밀번호를 입력해야 합니다.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-black/[0.08] bg-white/90 -mx-0.5 px-0.5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[560px] text-sm sm:text-base">
              <thead>
                <tr className="bg-muted/50 text-left text-xs font-medium text-[#64748b]">
                  <th className="px-3 py-2 w-[26%]">관리 범위</th>
                  <th className="px-3 py-2 w-[32%]">관리자 사번</th>
                  <th className="px-3 py-2">비밀번호 (변경 시)</th>
                  <th className="px-2 py-2 w-[88px] text-center"> </th>
                </tr>
              </thead>
              <tbody>
                {adminRowEntries.map((entry) => {
                  const team = sortedTeams.find((x) => x.id === entry.teamId);
                  if (!team) return null;
                  const baseName = team.name.trim() || '(이름 없음)';
                  const scopeLabel = entry.isPrimary ? `${baseName} (주)` : `${baseName} (추가)`;
                  return (
                    <tr key={entry.rowKey} className="border-t border-border/60">
                      <td className="px-3 py-2 align-middle font-medium text-[#1e293b]">{scopeLabel}</td>
                      <td className="px-3 py-1.5 align-middle">
                        <Input
                          value={entry.adminLoginId}
                          onChange={(e) => updateAdminEntry(entry.rowKey, { adminLoginId: e.target.value })}
                          className="h-9 rounded-lg border-black/[0.08] text-base"
                          placeholder="사번"
                          autoComplete="username"
                        />
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <PasswordInputWithToggle
                          value={masterAdminPasswordDisplayValue(
                            entry.passwordPlain,
                            entry.rowKey,
                            committedPlainByRow,
                            entry.hasStoredPassword
                          )}
                          onChange={(v) => setTeamPasswordField(entry.rowKey, v)}
                          inputClassName="h-9 rounded-lg border-black/[0.08] text-base"
                          placeholder={
                            entry.hasStoredPassword || committedPlainByRow[entry.rowKey]
                              ? ''
                              : entry.isPrimary
                                ? '저장 시 비밀번호 설정'
                                : '추가 관리자 최초 비밀번호'
                          }
                          autoComplete="new-password"
                        />
                      </td>
                      <td className="px-1 py-1.5 align-middle text-center">
                        {entry.isPrimary ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs text-primary"
                            onClick={() => addExtraTeamAdmin(entry.teamId)}
                          >
                            + 추가
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            onClick={() => removeAdminEntry(entry.rowKey)}
                            title="이 추가 관리자 삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {globalRows.map((row) => (
                  <tr key={row.rowKey} className={cn('border-t border-border/60', 'bg-primary/[0.04]')}>
                    <td className="px-3 py-2 align-middle font-semibold text-primary">
                      {row.isPrimary ? '전체팀 (주)' : '전체팀 (추가)'}
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      <Input
                        value={row.adminLoginId}
                        onChange={(e) => updateGlobalRow(row.rowKey, { adminLoginId: e.target.value })}
                        className="h-9 rounded-lg border-black/[0.08] text-base"
                        placeholder="사번"
                        autoComplete="username"
                      />
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      <PasswordInputWithToggle
                        value={masterAdminPasswordDisplayValue(
                          row.passwordPlain,
                          row.rowKey,
                          committedPlainByRow,
                          row.hasStoredPassword
                        )}
                        onChange={(v) => setGlobalPasswordField(row.rowKey, v)}
                        inputClassName="h-9 rounded-lg border-black/[0.08] text-base"
                        placeholder={
                          row.hasStoredPassword || committedPlainByRow[row.rowKey]
                            ? ''
                            : row.isPrimary
                              ? '최초 설정 시 필수'
                              : '추가 최초 시 필수'
                        }
                        autoComplete="new-password"
                      />
                    </td>
                    <td className="px-1 py-1.5 align-middle text-center">
                      {row.isPrimary ? (
                        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-primary" onClick={addGlobalExtra}>
                          + 추가
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => removeGlobalRow(row.rowKey)}
                          title="이 추가 관리자 삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {(onGenerateSampleData || onResetOperationalData) && (
          <section className="worklog-day-card flex flex-col p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                데이터 도구
              </h3>
              <p className="text-xs text-[#64748b] mt-1.5 leading-relaxed">
                샘플 적용·기록 삭제는 <strong className="text-foreground">마스터만</strong> 사용하세요. 팀·관리자 사번·비밀번호·마스터
                설정은 그대로 유지됩니다.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              {onGenerateSampleData && (
                <div className="flex flex-col gap-3 rounded-xl border border-black/[0.06] bg-secondary/15 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">샘플데이터 생성</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      팀원 6명(인원당 대분류 최대 4개), 2026년 2·3월 업무 기록 샘플을 넣습니다. 현재 선택된 팀(전체팀이면 품질보증2팀)
                      기준입니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-xl worklog-btn-primary px-4 py-2.5 text-base disabled:opacity-50"
                    disabled={generatingSample}
                    onClick={async () => {
                      setGeneratingSample(true);
                      try {
                        await onGenerateSampleData();
                        toast.success('샘플데이터가 적용되었습니다.');
                      } catch (e) {
                        console.error(e);
                        const msg = e instanceof Error ? e.message : String(e);
                        toast.error(msg ? `샘플데이터 적용 실패: ${msg}` : '샘플데이터 적용에 실패했습니다.');
                      } finally {
                        setGeneratingSample(false);
                      }
                    }}
                  >
                    {generatingSample ? '적용 중…' : '샘플데이터 생성'}
                  </button>
                </div>
              )}
              {onResetOperationalData && (
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-destructive flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      팀원·업무 기록 일괄 삭제
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      등록된 팀원과 모든 업무 기록만 삭제합니다. 팀 목록·관리자 설정·마스터 계정·분류 구조는 유지됩니다.
                    </p>
                  </div>
                  {!showDataResetConfirm ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-xl border border-destructive/35 bg-white px-4 py-2.5 text-base font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10"
                      onClick={() => setShowDataResetConfirm(true)}
                    >
                      기록·팀원 삭제
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 justify-end sm:justify-start">
                      <span className="text-xs font-medium text-destructive">진행할까요?</span>
                      <Button type="button" variant="ghost" size="sm" className="rounded-lg" onClick={() => setShowDataResetConfirm(false)}>
                        취소
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="rounded-lg"
                        onClick={async () => {
                          setShowDataResetConfirm(false);
                          try {
                            await onResetOperationalData();
                            toast.success('팀원·업무 기록이 삭제되었습니다.');
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : '삭제에 실패했습니다.');
                          }
                        }}
                      >
                        삭제 실행
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
