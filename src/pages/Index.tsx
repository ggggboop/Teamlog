import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  min as minDate,
  max as maxDate,
} from 'date-fns';
import { TeamSidebar } from '@/components/TeamSidebar';
import { WeeklyRowView } from '@/components/WeeklyRowView';
import { PersonalRecordsDialog } from '@/components/PersonalRecordsDialog';
import { PersonalStatsDialog } from '@/components/PersonalStatsDialog';
import { AdminDashboard, type AdminDashboardTab, type AdminShellTab } from '@/components/AdminDashboard';
import { AdminPasswordDialog } from '@/components/AdminPasswordDialog';
import { MasterTeamSettingsPanel } from '@/components/MasterTeamSettingsPanel';
import { AuditLogsPanel } from '@/components/AuditLogsPanel';
import { LoginScreen } from '@/components/LoginScreen';
import { getStoredTeamId, setStoredTeamId, clearStoredTeamId } from '@/utils/sessionKeys';
import { useDataService } from '@/hooks/useDataService';
import { TeamMember, WorkTeam } from '@/types/workLog';
import { GLOBAL_TEAM_ADMIN_SCOPE_ID } from '@/constants/globalTeamAdmin';
import {
  categoryFavoritesAuthorScope,
  filterValidFavorites,
  readCategoryFavorites,
} from '@/utils/categoryFavorites';
import {
  getSessionRole,
  setSessionRole,
  clearSessionRole,
  getTeamAdminOk,
  setTeamAdminOk,
  clearAllTeamAdminOk,
  getLastLoginEmployee,
  type StoredSessionRole,
} from '@/utils/sessionKeys';
function normEmployeeNo(s: string | null | undefined): string {
  return (s ?? '').trim();
}

function initSelectedTeamId(): string | null {
  const id = getStoredTeamId();
  const r = getSessionRole();
  if (id && r) return id;
  if (id && !r) clearStoredTeamId();
  return null;
}

function initSessionRole(): StoredSessionRole | null {
  const id = getStoredTeamId();
  const r = getSessionRole();
  if (id && r) return r;
  return null;
}

const Index = () => {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(initSelectedTeamId);
  const [sessionRole, setSessionRoleState] = useState<StoredSessionRole | null>(initSessionRole);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [adminShellTab, setAdminShellTab] = useState<AdminShellTab>('admin_home');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [writerRecordsOpen, setWriterRecordsOpen] = useState(false);
  const [writerStatsOpen, setWriterStatsOpen] = useState(false);
  const [categoryFavRevision, setCategoryFavRevision] = useState(0);
  /** 팀원·주차·월 그리드 범위 일괄 로드 — 캘린더·주간 연차 UI 공유 */
  const [dailyLeaveTypes, setDailyLeaveTypes] = useState<Record<string, string | null>>({});
  const [leaveTypesLoaded, setLeaveTypesLoaded] = useState(false);
  /** 연차·연장 변경 후 저장 시 flush (WeeklyRowView와 공유) */
  const dailyMetaDirtyRef = useRef(false);
  const leaveLoadGenRef = useRef(0);
  /** 다이얼로그가 성공 시에는 팀 선택으로 보내지 않음 */
  const skipGateDismissOnCloseRef = useRef(false);

  const {
    teams,
    members,
    logs,
    categories,
    categoriesTree,
    loading,
    addMember,
    updateMember,
    deleteMember,
    saveAllLogs,
    getLogsByMember,
    updateCategories,
    updateCategoriesTree,
    importData,
    clearAllData,
    resetData,
    getDailyTotalWorkHours,
    getDailyExtensionHours,
    setDailyExtensionHours,
    getMemberMemo,
    setMemberMemo,
    getDailyLeaveType,
    setDailyLeaveType,
    verifyMasterLogin,
    verifyTeamAdmin,
    saveAdminTeamsTransaction,
    workRecordStartDate,
    globalTeamAdminPreview,
    masterLoginPreview,
    changeAdminPasswordSelf,
  } = useDataService(selectedTeamId);

  const categoryFavoritesScope = useMemo(
    () => categoryFavoritesAuthorScope(sessionRole, selectedTeamId, getLastLoginEmployee()),
    [sessionRole, selectedTeamId]
  );

  const favoriteCategoryKeys = useMemo(
    () =>
      filterValidFavorites(
        readCategoryFavorites(selectedTeamId, categoryFavoritesScope),
        categoriesTree
      ),
    [selectedTeamId, categoryFavoritesScope, categoriesTree, categoryFavRevision]
  );

  const bumpCategoryFavorites = useCallback(() => setCategoryFavRevision((n) => n + 1), []);

  /** 사이드 미니 캘린더: 선택 팀원·취소 제외 업무가 있는 날짜 */
  const workLogDatesForCalendar = useMemo(() => {
    const s = new Set<string>();
    if (!selectedMember) return s;
    for (const l of logs) {
      if (l.memberId === selectedMember.id && l.status !== '취소') s.add(l.date);
    }
    return s;
  }, [logs, selectedMember?.id]);

  const [teamAdminOk, setTeamAdminOkLocal] = useState(() => {
    const id = initSelectedTeamId();
    const r = initSessionRole();
    if (!id) return false;
    if (r === 'master' || r === 'director') return true;
    if (r !== 'admin') return false;
    return getTeamAdminOk(id);
  });

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamAdminOkLocal(false);
      return;
    }
    if (sessionRole === 'master' || sessionRole === 'director') {
      setTeamAdminOkLocal(true);
      return;
    }
    setTeamAdminOkLocal(getTeamAdminOk(selectedTeamId));
  }, [selectedTeamId, sessionRole]);

  const currentTeamName = useMemo(() => {
    if (selectedTeamId === GLOBAL_TEAM_ADMIN_SCOPE_ID) return '전체팀';
    return teams.find((t: WorkTeam) => t.id === selectedTeamId)?.name;
  }, [teams, selectedTeamId]);

  const needsTeamAdminGate =
    Boolean(selectedTeamId) && sessionRole === 'admin' && !teamAdminOk;

  const adminSidebarDisabled =
    sessionRole === 'writer' || ((sessionRole === 'admin' || sessionRole === 'director') && !teamAdminOk);

  const handleLoginWriterComplete = (member: TeamMember) => {
    setSessionRole('writer');
    setSessionRoleState('writer');
    setStoredTeamId(member.teamId);
    setSelectedTeamId(member.teamId);
    setSelectedMember(member);
    setIsAdminView(false);
    setTeamAdminOkLocal(false);
  };

  const handleLoginAdminComplete = (payload: { teamId: string; role: 'admin' | 'director' | 'master' }) => {
    setSessionRole(payload.role);
    setSessionRoleState(payload.role);
    setStoredTeamId(payload.teamId);
    setSelectedTeamId(payload.teamId);
    setTeamAdminOk(payload.teamId, true);
    setTeamAdminOkLocal(true);
    setSelectedMember(null);
    setIsAdminView(payload.role === 'master');
    setAdminShellTab('admin_home');
  };

  const handleTeamAdminVerified = () => {
    if (!selectedTeamId) return;
    skipGateDismissOnCloseRef.current = true;
    setTeamAdminOk(selectedTeamId, true);
    setTeamAdminOkLocal(true);
    setIsAdminView(false);
  };

  const handleMasterVerifiedAtGate = () => {
    if (!selectedTeamId) return;
    skipGateDismissOnCloseRef.current = true;
    setTeamAdminOk(selectedTeamId, true);
    setTeamAdminOkLocal(true);
    setSessionRole('master');
    setSessionRoleState('master');
    setIsAdminView(false);
  };

  const handleTeamAdminDialogOpenChange = (open: boolean) => {
    if (open) return;
    if (skipGateDismissOnCloseRef.current) {
      skipGateDismissOnCloseRef.current = false;
      return;
    }
    handleDismissTeamAdminGate(false);
  };

  const handleDismissTeamAdminGate = (open: boolean) => {
    if (open) return;
    setSelectedTeamId(null);
    clearStoredTeamId();
    clearSessionRole();
    clearAllTeamAdminOk();
    setSessionRoleState(null);
    setTeamAdminOkLocal(false);
  };

  const handleChangeTeam = () => {
    setSelectedTeamId(null);
    clearStoredTeamId();
    clearSessionRole();
    clearAllTeamAdminOk();
    setSessionRoleState(null);
    setSelectedMember(null);
    setIsAdminView(false);
    setTeamAdminOkLocal(false);
  };

  const addMemberInTeam = useCallback(
    async (member: Omit<TeamMember, 'id'>) => {
      if (!selectedTeamId) throw new Error('팀이 선택되지 않았습니다.');
      return addMember({ ...member, teamId: selectedTeamId });
    },
    [addMember, selectedTeamId]
  );

  useEffect(() => {
    if (isAdminView || !selectedTeamId) return;

    const pickDefaultMember = (): TeamMember | null => {
      if (members.length === 0) return null;
      if (sessionRole === 'writer') {
        const login = getLastLoginEmployee();
        if (login) {
          const self = members.find((m) => normEmployeeNo(m.employeeNo) === normEmployeeNo(login));
          if (self) return self;
        }
      }
      return members[0] ?? null;
    };

    if (!selectedMember && members.length > 0) {
      setSelectedMember(pickDefaultMember());
    } else if (selectedMember && !members.some((m) => m.id === selectedMember.id)) {
      setSelectedMember(pickDefaultMember());
    }
  }, [members, selectedMember, isAdminView, selectedTeamId, sessionRole]);

  /** 선택된 팀원 객체를 members 목록과 동기화(프로필 저장 직후 UI 즉시 반영) */
  useEffect(() => {
    if (!selectedMember || isAdminView || !selectedTeamId) return;
    const fresh = members.find((m) => m.id === selectedMember.id);
    if (!fresh) return;
    const stA = (fresh.statusMessage ?? '').trim();
    const stB = (selectedMember.statusMessage ?? '').trim();
    if (
      fresh.avatar !== selectedMember.avatar ||
      stA !== stB ||
      fresh.name !== selectedMember.name ||
      fresh.role !== selectedMember.role
    ) {
      setSelectedMember(fresh);
    }
  }, [members, selectedMember, isAdminView, selectedTeamId]);

  /** 일반 작성자가 본인이 아닌 팀원 주간 화면을 볼 때: 열람만 */
  const writerViewingOtherMember = useMemo(() => {
    if (sessionRole !== 'writer') return false;
    const login = getLastLoginEmployee();
    if (!login || !selectedMember) return false;
    return normEmployeeNo(selectedMember.employeeNo) !== normEmployeeNo(login);
  }, [sessionRole, selectedMember]);

  const handleDailyLeaveChange = useCallback(
    (dateKey: string, value: string | null) => {
      if (!selectedMember || writerViewingOtherMember) return;
      setDailyLeaveTypes((prev) => ({ ...prev, [dateKey]: value }));
      dailyMetaDirtyRef.current = true;
      void setDailyLeaveType(selectedMember.id, dateKey, value);
    },
    [selectedMember, writerViewingOtherMember, setDailyLeaveType]
  );

  useEffect(() => {
    if (!selectedMember || isAdminView) {
      setDailyLeaveTypes({});
      setLeaveTypesLoaded(false);
      return;
    }
    const gen = ++leaveLoadGenRef.current;
    setLeaveTypesLoaded(false);
    let cancelled = false;
    const load = async () => {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
      const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
      const start = minDate([calStart, weekStart]);
      const end = maxDate([calEnd, weekEnd]);
      const days = eachDayOfInterval({ start, end });
      const leaveMap: Record<string, string | null> = {};
      await Promise.all(
        days.map(async (day) => {
          const dk = format(day, 'yyyy-MM-dd');
          const leave = await getDailyLeaveType(selectedMember.id, dk);
          leaveMap[dk] = leave;
        })
      );
      if (cancelled || leaveLoadGenRef.current !== gen) return;
      setDailyLeaveTypes(leaveMap);
      setLeaveTypesLoaded(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedMember?.id, currentDate, getDailyLeaveType, isAdminView]);

  const handleSelectMember = (member: TeamMember) => {
    setSelectedMember(member);
    setIsAdminView(false);
  };

  const handleAdminClick = () => {
    if (adminSidebarDisabled) return;
    if (isAdminView) return;
    setIsAdminView(true);
    setSelectedMember(null);
    setAdminShellTab('admin_home');
  };

  const handleExitAdminView = () => {
    setIsAdminView(false);
  };

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      if (!teamId || teamId === selectedTeamId) return;
      setStoredTeamId(teamId);
      setSelectedTeamId(teamId);
      setSelectedMember(null);
      if (sessionRole === 'master' || sessionRole === 'director') {
        setTeamAdminOkLocal(true);
        return;
      }
      if (sessionRole === 'admin') {
        const ok = getTeamAdminOk(teamId);
        setTeamAdminOkLocal(ok);
        if (!ok) setIsAdminView(false);
      }
    },
    [selectedTeamId, sessionRole]
  );

  const memberLogs = useMemo(() => {
    if (!selectedMember) return [];
    return getLogsByMember(selectedMember.id);
  }, [selectedMember, getLogsByMember]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="text-muted-foreground text-base">로딩 중...</div>
      </div>
    );
  }

  if (!selectedTeamId) {
    return (
      <LoginScreen
        teams={teams}
        loading={loading}
        globalTeamAdminPreview={globalTeamAdminPreview}
        masterLoginPreview={masterLoginPreview}
        verifyTeamAdmin={verifyTeamAdmin}
        verifyMasterLogin={verifyMasterLogin}
        onWriterComplete={handleLoginWriterComplete}
        onAdminComplete={handleLoginAdminComplete}
      />
    );
  }

  const showTeamAdminDialog = needsTeamAdminGate;

  if (needsTeamAdminGate) {
    return (
      <div className="flex h-screen w-full flex-col bg-background">
        <AdminPasswordDialog
          open={showTeamAdminDialog}
          onOpenChange={handleTeamAdminDialogOpenChange}
          teamId={selectedTeamId!}
          teamName={currentTeamName}
          verifyTeamAdmin={verifyTeamAdmin}
          verifyMasterLogin={verifyMasterLogin}
          onMasterSuccess={handleMasterVerifiedAtGate}
          onSuccess={handleTeamAdminVerified}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col worklog-app-shell">
      <div className="flex min-h-0 flex-1 w-full">
        <TeamSidebar
          members={members}
          selectedMember={selectedMember}
          onSelectMember={handleSelectMember}
          onAdminClick={handleAdminClick}
          isAdminView={isAdminView}
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          getMemberMemo={getMemberMemo}
          setMemberMemo={setMemberMemo}
          teamName={currentTeamName}
          teams={teams}
          selectedTeamId={selectedTeamId}
          onSelectTeam={handleSelectTeam}
          onChangeTeam={handleChangeTeam}
          adminDisabled={adminSidebarDisabled}
          sessionRole={sessionRole}
          adminActiveTab={adminShellTab}
          onAdminTabChange={setAdminShellTab}
          onExitAdminView={handleExitAdminView}
          onOpenPersonalRecords={() => setWriterRecordsOpen(true)}
          onOpenPersonalStats={() => setWriterStatsOpen(true)}
          onUpdateMember={updateMember}
          categoriesTree={categoriesTree}
          favoriteCategoryKeys={favoriteCategoryKeys}
          onCategoryFavoritesChange={bumpCategoryFavorites}
          categoryFavoritesScope={categoryFavoritesScope}
          workLogDatesForCalendar={workLogDatesForCalendar}
          dailyLeaveTypes={dailyLeaveTypes}
          onDailyLeaveChange={handleDailyLeaveChange}
          calendarLeaveReadOnly={writerViewingOtherMember}
        />

        <main className="flex-1 overflow-hidden worklog-main-surface">
          {isAdminView && adminShellTab === 'audit' ? (
            <AuditLogsPanel />
          ) : isAdminView && adminShellTab === 'master' ? (
            <MasterTeamSettingsPanel
              teams={teams}
              globalTeamAdminPreview={globalTeamAdminPreview}
              workRecordStartDate={workRecordStartDate}
              onSave={saveAdminTeamsTransaction}
              onGenerateSampleData={() => resetData(selectedTeamId)}
              onResetOperationalData={clearAllData}
            />
          ) : isAdminView ? (
            <AdminDashboard
              members={members}
              teams={teams}
              logs={logs}
              categories={categories}
              categoriesTree={categoriesTree}
              onAddMember={addMemberInTeam}
              onUpdateMember={updateMember}
              onDeleteMember={deleteMember}
              onUpdateCategories={updateCategories}
              onUpdateCategoriesTree={updateCategoriesTree}
              onImportData={importData}
              getDailyLeaveType={getDailyLeaveType}
              getDailyTotalWorkHours={getDailyTotalWorkHours}
              activeTab={adminShellTab as AdminDashboardTab}
              selectedTeamId={selectedTeamId}
              globalTeamAdminPreview={globalTeamAdminPreview}
              onChangeAdminPassword={changeAdminPasswordSelf}
              onAdminShellNavigate={setAdminShellTab}
              sessionRole={sessionRole}
            />
          ) : selectedTeamId === GLOBAL_TEAM_ADMIN_SCOPE_ID && members.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center max-w-md mx-auto">
              <p className="text-muted-foreground text-base">전체팀 범위가 선택되었습니다.</p>
              <p className="text-xs text-muted-foreground">
                사이드바에서 실제 팀을 선택하면 해당 팀의 업무 기록을 작성·열람할 수 있습니다.
              </p>
            </div>
          ) : selectedMember ? (
            <WeeklyRowView
              member={selectedMember}
              logs={memberLogs}
              categories={categories}
              categoriesTree={categoriesTree}
              currentDate={currentDate}
              onSaveAll={saveAllLogs}
              getDailyExtensionHours={getDailyExtensionHours}
              setDailyExtensionHours={setDailyExtensionHours}
              setDailyLeaveType={setDailyLeaveType}
              dailyLeaveTypes={dailyLeaveTypes}
              onDailyLeaveChange={handleDailyLeaveChange}
              leaveTypesLoaded={leaveTypesLoaded}
              dailyMetaDirtyRef={dailyMetaDirtyRef}
              workRecordStartDate={workRecordStartDate}
              readOnly={writerViewingOtherMember}
              favoriteCategoryKeys={favoriteCategoryKeys}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-muted-foreground text-base">이 팀에 등록된 팀원이 없습니다.</p>
              <p className="text-xs text-muted-foreground">관리자에서 팀원을 추가하거나 다른 팀을 선택하세요.</p>
            </div>
          )}
        </main>
      </div>

      {selectedMember && !isAdminView && (
        <>
          <PersonalRecordsDialog
            open={writerRecordsOpen}
            onOpenChange={setWriterRecordsOpen}
            member={selectedMember}
            logs={logs}
          />
          <PersonalStatsDialog
            open={writerStatsOpen}
            onOpenChange={setWriterStatsOpen}
            member={selectedMember}
            logs={logs}
            categories={categories}
            currentDate={currentDate}
            getDailyLeaveType={getDailyLeaveType}
          />
        </>
      )}
    </div>
  );
};

export default Index;
