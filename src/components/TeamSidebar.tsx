import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  BarChart3,
  Settings,
  FileText,
  LogOut,
  ChevronDown,
  PenLine,
  Shield,
  Users,
  Layers,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  StickyNote,
  Smile,
  Star,
} from 'lucide-react';
import type { AdminShellTab } from '@/components/AdminDashboard';
import type { StoredSessionRole } from '@/utils/sessionKeys';
import { getLastLoginEmployee } from '@/utils/sessionKeys';
import { startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { TeamMember, WorkTeam, type Category } from '@/types/workLog';
import { clearCategoryFavorites, toggleCategoryFavorite } from '@/utils/categoryFavorites';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MiniCalendar } from './MiniCalendar';
import { SettingsDialog } from './SettingsDialog';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TeamlogBrand } from '@/components/TeamlogBrand';
import { MemberEmojiBubble } from '@/components/MemberEmojiBubble';
import { MemberProfileManageDialog } from '@/components/MemberProfileManageDialog';
import {
  mergeProfileBaselineWithMembers,
  memberHasProfilePing,
  readProfileBaseline,
  recordMemberProfileSeen,
  teamHasAnyProfilePing,
} from '@/utils/memberProfile';
import { toast } from 'sonner';

function teamInitials(name: string): string {
  const t = name.trim();
  if (t.length === 0) return '?';
  if (t.length <= 2) return t;
  return t.slice(0, 2);
}

function normEmp(s: string | null | undefined): string {
  return (s ?? '').trim();
}

/** 대분류만 또는 해당 대분류 하위 소분류 즐겨찾기가 하나라도 있는지 */
function majorHasFavorite(majorName: string, favoriteKeys: readonly string[]): boolean {
  if (favoriteKeys.includes(majorName)) return true;
  const prefix = `${majorName} > `;
  return favoriteKeys.some((k) => k.startsWith(prefix));
}

function isWriterLoggedInMember(m: TeamMember, sessionRole: StoredSessionRole | null): boolean {
  if (sessionRole !== 'writer') return false;
  const login = getLastLoginEmployee();
  if (!login) return false;
  return normEmp(m.employeeNo) === normEmp(login);
}

interface TeamSidebarProps {
  members: TeamMember[];
  selectedMember: TeamMember | null;
  onSelectMember: (member: TeamMember) => void;
  onAdminClick: () => void;
  isAdminView: boolean;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  getMemberMemo: (memberId: string) => Promise<string>;
  setMemberMemo: (memberId: string, content: string) => Promise<void>;
  teamName?: string;
  teams?: WorkTeam[];
  selectedTeamId?: string | null;
  onSelectTeam?: (teamId: string) => void;
  onChangeTeam?: () => void;
  adminDisabled?: boolean;
  sessionRole?: StoredSessionRole | null;
  adminActiveTab: AdminShellTab;
  onAdminTabChange: (tab: AdminShellTab) => void;
  onExitAdminView: () => void;
  /** 작성 화면: 사이드 메뉴에서 내 기록 / 내 통계 */
  onOpenPersonalRecords?: () => void;
  onOpenPersonalStats?: () => void;
  /** 프로필 이모지(avatar) 저장 */
  onUpdateMember?: (id: string, updates: Partial<TeamMember>) => Promise<void>;
  /** 업무 분류 트리 — 있을 때만 「분류 즐겨찾기」 표시 */
  categoriesTree?: Category[];
  /** 팀별 유효 즐겨찾기 키 (부모에서 localStorage 반영) */
  favoriteCategoryKeys?: string[];
  /** 즐겨찾기 변경 시 부모가 목록을 다시 읽도록 알림 */
  onCategoryFavoritesChange?: () => void;
  /** localStorage 스코프(팀+작성자) — null이면 즐겨찾기 메뉴 숨김 */
  categoryFavoritesScope?: string | null;
  /** 선택 팀원 기준 업무가 기록된 날짜(yyyy-MM-dd) — 미니 캘린더 점 표시 */
  workLogDatesForCalendar?: ReadonlySet<string>;
  /** 일자별 연차·반차(주간 카드·캘린더 공유) */
  dailyLeaveTypes?: Record<string, string | null>;
  onDailyLeaveChange?: (dateKey: string, value: string | null) => void;
  /** true면 캘린더에서 연차 선택 비활성 */
  calendarLeaveReadOnly?: boolean;
}

export function TeamSidebar({
  members,
  selectedMember,
  onSelectMember,
  onAdminClick,
  isAdminView,
  currentDate,
  onDateChange,
  getMemberMemo,
  setMemberMemo,
  teamName,
  teams = [],
  selectedTeamId = null,
  onSelectTeam,
  onChangeTeam,
  adminDisabled = false,
  sessionRole = null,
  adminActiveTab,
  onAdminTabChange,
  onExitAdminView,
  onOpenPersonalRecords,
  onOpenPersonalStats,
  onUpdateMember,
  categoriesTree = [],
  favoriteCategoryKeys = [],
  onCategoryFavoritesChange,
  categoryFavoritesScope = null,
  workLogDatesForCalendar,
  dailyLeaveTypes = {},
  onDailyLeaveChange,
  calendarLeaveReadOnly = false,
}: TeamSidebarProps) {
  const [memoContent, setMemoContent] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [categoryFavDialogOpen, setCategoryFavDialogOpen] = useState(false);
  const [favSelectedMajorId, setFavSelectedMajorId] = useState<number | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [profileManageOpen, setProfileManageOpen] = useState(false);
  const [profileBaselineTick, setProfileBaselineTick] = useState(0);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.sortOrder - b.sortOrder),
    [teams]
  );
  const currentTeamMeta = useMemo(
    () => sortedTeams.find((t) => t.id === selectedTeamId),
    [sortedTeams, selectedTeamId]
  );

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });

  const handlePrevWeek = () => onDateChange(subWeeks(currentDate, 1));
  const handleNextWeek = () => onDateChange(addWeeks(currentDate, 1));
  const handleToday = () => onDateChange(new Date());

  const canSetProfileEmoji = useMemo(() => {
    if (!selectedMember || !onUpdateMember) return false;
    /** 일반 팀 관리자는 팀원 이모지·상태메시지 변경 불가 (마스터·본인 작성자만) */
    if (sessionRole === 'admin') return false;
    if (sessionRole === 'master') return true;
    return isWriterLoggedInMember(selectedMember, sessionRole);
  }, [selectedMember, onUpdateMember, sessionRole]);

  const profileBaseline = useMemo(
    () => readProfileBaseline(selectedTeamId ?? ''),
    [selectedTeamId, profileBaselineTick]
  );

  const showMemberProfilePing = useCallback(
    (m: TeamMember) =>
      sessionRole === 'writer' && Boolean(selectedTeamId) && memberHasProfilePing(profileBaseline, m),
    [sessionRole, selectedTeamId, profileBaseline]
  );

  /** 메인 트리거 우측 상단: 팀원 중 한 명이라도 미확인 프로필 변경이 있으면 표시 */
  const showTeamProfileAlertDot =
    sessionRole === 'writer' &&
    Boolean(selectedTeamId) &&
    teamHasAnyProfilePing(profileBaseline, members);

  const memberBubbleWithPing = (m: TeamMember | null, size: 'sm' | 'md', teamAlert?: boolean): ReactNode => (
    <div className="relative shrink-0 self-start">
      <MemberEmojiBubble member={m} size={size} />
      {m && showMemberProfilePing(m) ? (
        <span
          className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white shadow-sm z-[1]"
          title="프로필이 바뀌었습니다"
          aria-hidden
        />
      ) : teamAlert ? (
        <span
          className="pointer-events-none absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white shadow-sm z-[1] animate-pulse"
          title="팀원 프로필이 변경되었습니다. 목록을 열어 확인해 주세요."
          aria-hidden
        />
      ) : null}
    </div>
  );

  const memberTitleBlock = (m: TeamMember | null, loginBadge: ReactNode) => (
    <div className="min-w-0 flex-1 text-left">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0">
          <span className="text-base font-medium text-[#1e293b] truncate max-w-full">{m ? m.name : '팀원 선택'}</span>
          {m?.role ? (
            <span className="shrink-0 text-xs font-medium text-[#64748b]">{m.role}</span>
          ) : null}
        </div>
        {loginBadge}
      </div>
      {m?.statusMessage?.trim() ? (
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#94a3b8]" title={m.statusMessage.trim()}>
          {m.statusMessage.trim()}
        </p>
      ) : !m ? (
        <p className="text-xs text-[#64748b] truncate mt-0.5">목록에서 선택하세요</p>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (selectedMember && !isAdminView) {
      let cancelled = false;
      getMemberMemo(selectedMember.id).then((v) => {
        if (!cancelled) setMemoContent(v);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [selectedMember?.id, getMemberMemo, isAdminView]);

  useEffect(() => {
    if (!selectedMember) setMemoOpen(false);
  }, [selectedMember]);

  useEffect(() => {
    if (isAdminView) {
      setMemoOpen(false);
      setCategoryFavDialogOpen(false);
    }
  }, [isAdminView]);

  useEffect(() => {
    if (!categoryFavDialogOpen) setFavSelectedMajorId(null);
  }, [categoryFavDialogOpen]);

  const { favMajorCategories, favSubByParent } = useMemo(() => {
    const normalized = categoriesTree.map((c) => ({
      ...c,
      id: Number(c.id),
      parentId: c.parentId != null ? Number(c.parentId) : null,
      sortOrder: Number(c.sortOrder ?? 0),
    }));
    const majors = normalized.filter((c) => c.parentId == null).sort((a, b) => a.sortOrder - b.sortOrder);
    const subsBy = new Map<number, Category[]>();
    normalized
      .filter((c) => c.parentId != null)
      .forEach((c) => {
        const pid = c.parentId!;
        const arr = subsBy.get(pid) || [];
        arr.push(c);
        subsBy.set(pid, arr);
      });
    subsBy.forEach((arr) => arr.sort((a, b) => a.sortOrder - b.sortOrder));
    return { favMajorCategories: majors, favSubByParent: subsBy };
  }, [categoriesTree]);

  const favSelectedMajor = useMemo(
    () =>
      favSelectedMajorId != null ? favMajorCategories.find((m) => m.id === favSelectedMajorId) ?? null : null,
    [favMajorCategories, favSelectedMajorId]
  );

  const showCategoryFavNav =
    !isAdminView &&
    Boolean(selectedTeamId) &&
    Boolean(categoryFavoritesScope) &&
    categoriesTree.length > 0;

  const handleFavToggleKey = (categoryKey: string) => {
    if (!selectedTeamId || !categoryFavoritesScope) return;
    toggleCategoryFavorite(selectedTeamId, categoryFavoritesScope, categoryKey);
    onCategoryFavoritesChange?.();
  };

  const handleClearCategoryFavorites = () => {
    if (!selectedTeamId || !categoryFavoritesScope) return;
    if (favoriteCategoryKeys.length === 0) {
      toast('초기화할 즐겨찾기가 없습니다.');
      return;
    }
    if (!window.confirm('분류 즐겨찾기를 모두 삭제할까요?')) return;
    clearCategoryFavorites(selectedTeamId, categoryFavoritesScope);
    onCategoryFavoritesChange?.();
    toast.success('즐겨찾기를 초기화했습니다.');
  };

  const handleMemoBlur = useCallback(() => {
    if (!selectedMember || memoSaving) return;
    setMemoSaving(true);
    setMemberMemo(selectedMember.id, memoContent).finally(() => setMemoSaving(false));
  }, [selectedMember, memoContent, setMemberMemo, memoSaving]);

  const footerBtnClass = (active?: boolean) =>
    cn(
      'w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-base font-medium transition-all duration-200',
      isAdminView
        ? cn(
            adminDisabled && 'opacity-40 cursor-not-allowed pointer-events-none',
            !adminDisabled && active
              ? 'bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-glow'
              : !adminDisabled && 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )
        : cn(
            'worklog-nav-item border border-transparent',
            active && 'worklog-nav-item-active',
            !active && 'text-[#64748b]'
          )
    );

  const adminMenuBtn = (active: boolean) =>
    cn(
      'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all duration-200 text-left border border-transparent',
      active
        ? 'worklog-nav-item-active ring-1 ring-inset ring-[#02a1c0]/30'
        : 'worklog-nav-item'
    );

  /** 작성자 화면의 관리자·로그아웃 버튼과 동일 톤 */
  const shellFooterBtnClass = cn(
    'w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-base font-medium transition-all duration-200',
    'worklog-nav-item border border-transparent text-[#64748b]'
  );

  const writerSidebarFooter = (
    <div className="p-3 space-y-2 shrink-0 border-t border-black/[0.04]">
      {onChangeTeam && (
        <button type="button" onClick={onChangeTeam} className={footerBtnClass(false)}>
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      )}
      {(sessionRole === 'admin' || sessionRole === 'master') && !adminDisabled && (
        <button type="button" onClick={onAdminClick} className={footerBtnClass(false)}>
          <BarChart3 className="w-4 h-4" />
          관리자
        </button>
      )}
      <SettingsDialog
        trigger={
          <button type="button" className={footerBtnClass(false)}>
            <Settings className="w-4 h-4" />
            환경 설정
          </button>
        }
      />
    </div>
  );

  if (isAdminView) {
    return (
      <aside className="worklog-sidebar-panel h-screen flex flex-col print:hidden">
        <div className="px-5 pt-6 pb-4">
          <TeamlogBrand />
          <p className="mt-2 truncate pl-1 text-xs text-[#64748b]" title={teamName || undefined}>
            {teamName ? teamName : '팀'}
            {members.length > 0 ? ` · ${members.length}명` : ''}
          </p>
          {sessionRole === 'master' && (
            <p className="mt-1.5 pl-1 text-[10px] font-medium text-primary">Master 세션</p>
          )}
          {sessionRole === 'director' && (
            <p className="mt-1.5 pl-1 text-[10px] font-medium text-primary">Director 세션</p>
          )}
        </div>

        {sortedTeams.length > 0 && onSelectTeam && (
          <div className="px-5 pb-4">
            <Popover open={teamPickerOpen} onOpenChange={setTeamPickerOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="worklog-team-selector-trigger">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[12px] font-semibold text-white"
                      style={{
                        background: 'linear-gradient(135deg, #02a1c0, #3b82f6)',
                      }}
                    >
                      {currentTeamMeta ? teamInitials(currentTeamMeta.name) : '?'}
                    </div>
                    <div className="min-w-0 text-left">
                      <h4 className="text-base font-medium text-[#1e293b] truncate">
                        {currentTeamMeta?.name ?? '팀 선택'}
                      </h4>
                      <p className="text-xs text-[#64748b] truncate">
                        팀원 {members.length}명 · 관리자 화면
                      </p>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 shrink-0 text-[#64748b]" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-1 max-h-72 overflow-y-auto"
                sideOffset={6}
              >
                <ul className="py-1">
                  {sortedTeams.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTeam(t.id);
                          setTeamPickerOpen(false);
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2.5 rounded-lg text-base transition-colors',
                          selectedTeamId === t.id
                            ? 'bg-[rgba(2,161,192,0.08)] text-[#02a1c0] font-medium'
                            : 'text-[#1e293b] hover:bg-[#f1f5f9]'
                        )}
                      >
                        <span className="block font-medium">{t.name}</span>
                        <span className="block text-xs text-[#64748b]">업무 팀</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-3 pb-2">
          <p className="px-1.5 mb-2 text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider">메뉴</p>
          <nav className="flex flex-col gap-1.5 min-h-0 overflow-y-auto px-1 py-1.5">
            <button
              type="button"
              onClick={() => onAdminTabChange('admin_home')}
              className={adminMenuBtn(adminActiveTab === 'admin_home')}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              관리홈
            </button>
            <button
              type="button"
              onClick={() => onAdminTabChange('summary_dashboard')}
              className={adminMenuBtn(adminActiveTab === 'summary_dashboard')}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              요약 대시보드
            </button>
            <button
              type="button"
              onClick={() => onAdminTabChange('statistics_category')}
              className={adminMenuBtn(adminActiveTab === 'statistics_category')}
            >
              <Layers className="w-4 h-4 shrink-0" />
              업무 분류별 통계
            </button>
            <button
              type="button"
              onClick={() => onAdminTabChange('statistics_members')}
              className={adminMenuBtn(adminActiveTab === 'statistics_members')}
            >
              <Users className="w-4 h-4 shrink-0" />
              팀원별 통계
            </button>
            <button
              type="button"
              onClick={() => onAdminTabChange('records')}
              className={adminMenuBtn(adminActiveTab === 'records')}
            >
              <FileText className="w-4 h-4 shrink-0" />
              기록 조회
            </button>
            <button
              type="button"
              onClick={() => onAdminTabChange('management_members')}
              className={adminMenuBtn(adminActiveTab === 'management_members')}
            >
              <Users className="w-4 h-4 shrink-0" />
              팀원 관리
            </button>
            <button
              type="button"
              onClick={() => onAdminTabChange('management_categories')}
              className={adminMenuBtn(adminActiveTab === 'management_categories')}
            >
              <Layers className="w-4 h-4 shrink-0" />
              업무 분류 관리
            </button>
            {sessionRole === 'admin' && (
              <button
                type="button"
                onClick={() => onAdminTabChange('management_admin_settings')}
                className={adminMenuBtn(adminActiveTab === 'management_admin_settings')}
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                관리자 설정
              </button>
            )}
            {sessionRole === 'master' && (
              <button
                type="button"
                onClick={() => onAdminTabChange('master')}
                className={adminMenuBtn(adminActiveTab === 'master')}
              >
                <Shield className="w-4 h-4 shrink-0" />
                마스터 관리
              </button>
            )}
          </nav>
        </div>

        <div className="mt-auto space-y-2 p-3">
          {onChangeTeam && (
            <button type="button" onClick={onChangeTeam} className={shellFooterBtnClass}>
              <LogOut className="w-4 h-4" />
              로그아웃
            </button>
          )}
          <button type="button" onClick={onExitAdminView} className={shellFooterBtnClass} title="작성 화면으로 돌아가기">
            <PenLine className="w-4 h-4" />
            업무 기록
          </button>
          <SettingsDialog
            trigger={
              <button type="button" className={shellFooterBtnClass}>
                <Settings className="w-4 h-4" />
                환경 설정
              </button>
            }
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="worklog-sidebar-panel h-screen flex flex-col print:hidden">
      <div className="px-5 pt-6 pb-4 shrink-0">
        <TeamlogBrand />
        <p className="mt-2 truncate pl-1 text-xs text-[#64748b]" title={teamName || undefined}>
          {teamName ? `${teamName}` : '팀'}
          {members.length > 0 ? ` · ${members.length}명` : ''}
        </p>
      </div>

      <div className="px-5 pb-4 shrink-0">
        <Popover
          open={memberPickerOpen}
          onOpenChange={(open) => {
            setMemberPickerOpen(open);
            if (!open && selectedTeamId) {
              mergeProfileBaselineWithMembers(selectedTeamId, members);
              setProfileBaselineTick((t) => t + 1);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className="worklog-team-selector-trigger relative">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {memberBubbleWithPing(selectedMember, 'md', showTeamProfileAlertDot)}
                {memberTitleBlock(selectedMember, null)}
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-[#64748b]" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-1 max-h-72 overflow-y-auto"
            sideOffset={6}
          >
            {members.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">등록된 팀원이 없습니다.</p>
            ) : (
              <ul className="py-1">
                {members.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectMember(m);
                        setMemberPickerOpen(false);
                      }}
                      className={cn(
                        'w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-lg text-base transition-colors',
                        selectedMember?.id === m.id
                          ? 'bg-[rgba(2,161,192,0.08)] text-[#02a1c0] font-medium'
                          : 'text-[#1e293b] hover:bg-[#f1f5f9]'
                      )}
                    >
                      {memberBubbleWithPing(m, 'sm')}
                      {memberTitleBlock(
                        m,
                        isWriterLoggedInMember(m, sessionRole) ? (
                          <span className="shrink-0 text-[10px] font-semibold text-primary">로그인</span>
                        ) : null
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-2">
        {memoOpen && selectedMember ? (
          <>
            <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-1 pb-2">
              <button
                type="button"
                onClick={() => setMemoOpen(false)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#02a1c0]"
              >
                닫기
              </button>
              <StickyNote className="h-4 w-4 shrink-0 text-[#02a1c0]" />
              <span className="text-sm font-semibold text-[#1e293b]">메모장</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <textarea
                value={memoContent}
                onChange={(e) => setMemoContent(e.target.value)}
                onBlur={handleMemoBlur}
                placeholder="메모를 입력하세요..."
                className="worklog-form-control min-h-0 flex-1 w-full resize-none overflow-y-auto placeholder:text-[#94a3b8] text-sm"
              />
              {memoSaving ? (
                <p className="mt-1 shrink-0 text-[10px] text-[#64748b]">저장 중...</p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {/* 메뉴만 스크롤 — 캘린더와 분리 */}
            <div className="worklog-sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5">
              <p className="mb-2 shrink-0 px-1 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                메뉴
              </p>
              <nav className="flex flex-col gap-1.5 px-1 pb-2">
                <button
                  type="button"
                  onClick={() => onOpenPersonalRecords?.()}
                  disabled={!selectedMember}
                  className={cn(
                    footerBtnClass(false),
                    !selectedMember && 'pointer-events-none opacity-40 cursor-not-allowed'
                  )}
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  내 기록
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPersonalStats?.()}
                  disabled={!selectedMember}
                  className={cn(
                    footerBtnClass(false),
                    !selectedMember && 'pointer-events-none opacity-40 cursor-not-allowed'
                  )}
                >
                  <BarChart3 className="h-4 w-4 shrink-0" />
                  내 통계
                </button>
                <button
                  type="button"
                  onClick={() => setMemoOpen((o) => !o)}
                  disabled={!selectedMember}
                  className={cn(
                    footerBtnClass(memoOpen),
                    !selectedMember && 'pointer-events-none opacity-40 cursor-not-allowed'
                  )}
                >
                  <StickyNote className="h-4 w-4 shrink-0" />
                  메모장
                </button>
                {showCategoryFavNav ? (
                  <button
                    type="button"
                    onClick={() => setCategoryFavDialogOpen(true)}
                    className={footerBtnClass(false)}
                  >
                    <Star className="h-4 w-4 shrink-0" />
                    분류 즐겨찾기
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setProfileManageOpen(true)}
                  disabled={!canSetProfileEmoji}
                  title={
                    !selectedMember
                      ? '팀원을 선택하세요'
                      : !onUpdateMember
                        ? '저장 기능을 사용할 수 없습니다'
                        : sessionRole === 'admin'
                          ? '일반 관리자는 팀원 프로필(이모지·상태메시지)을 변경할 수 없습니다'
                          : !canSetProfileEmoji
                            ? '본인을 선택한 뒤 설정할 수 있습니다'
                            : '프로필 이모지·상태메시지를 편집합니다'
                  }
                  className={cn(
                    footerBtnClass(false),
                    !canSetProfileEmoji && 'pointer-events-none opacity-40 cursor-not-allowed'
                  )}
                >
                  <Smile className="h-4 w-4 shrink-0" />
                  프로필 관리
                </button>
              </nav>
            </div>

            {/* 미니 캘린더: 메뉴와 분리 · 스크롤하지 않음(로그아웃 버튼 위 고정) */}
            <div className="shrink-0 border-t border-black/[0.06] px-0.5 pt-3 pb-1">
              <MiniCalendar
                currentDate={currentDate}
                weekStart={weekStart}
                weekEnd={weekEnd}
                onPrevWeek={handlePrevWeek}
                onNextWeek={handleNextWeek}
                onToday={handleToday}
                onDateChange={onDateChange}
                worklogStyle
                datesWithWorkRecords={workLogDatesForCalendar}
                leaveByDate={dailyLeaveTypes}
                onLeaveChange={selectedMember && onDailyLeaveChange ? onDailyLeaveChange : undefined}
                leavePickerReadOnly={calendarLeaveReadOnly}
              />
            </div>
          </>
        )}
      </div>

      {writerSidebarFooter}

      <Dialog open={categoryFavDialogOpen} onOpenChange={setCategoryFavDialogOpen}>
        <DialogContent className="flex h-[min(90vh,720px)] max-h-[90vh] w-[min(92vw,56rem)] max-w-[min(92vw,56rem)] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-6 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Star className="h-5 w-5 shrink-0 text-primary" />
              분류 즐겨찾기
            </DialogTitle>
            <p className="text-sm font-normal text-muted-foreground">
              대분류를 고른 뒤 소분류(또는 대분류만)를 눌러 청록 점을 켜면 업무 작성 시 해당 목록만 표시됩니다.
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden px-6 py-3">
            <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:grid-cols-2 sm:grid-rows-1">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-muted/20 sm:max-h-full">
              <p className="shrink-0 border-b border-border/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                대분류
              </p>
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
                {favMajorCategories.map((m) => {
                  const showMajorFavDot = majorHasFavorite(m.name, favoriteCategoryKeys);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setFavSelectedMajorId(m.id)}
                        className={cn(
                          'mx-2 flex w-[calc(100%-1rem)] items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                          favSelectedMajorId === m.id
                            ? 'bg-primary/15 font-medium text-primary'
                            : 'text-foreground hover:bg-muted/80'
                        )}
                      >
                        <span className="min-w-0 truncate">{m.name}</span>
                        {showMajorFavDot ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-[#14b8a6]"
                            title="이 대분류에 즐겨찾기가 있습니다"
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-muted/20 sm:max-h-full">
              <p className="shrink-0 border-b border-border/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                소분류
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
                {!favSelectedMajor ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">왼쪽에서 대분류를 선택하세요</p>
                ) : (
                  <ul className="space-y-0.5 py-1">
                    <li>
                      <button
                        type="button"
                        onClick={() => handleFavToggleKey(favSelectedMajor.name)}
                        className="mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/80"
                      >
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            favoriteCategoryKeys.includes(favSelectedMajor.name)
                              ? 'bg-[#14b8a6]'
                              : 'border border-muted-foreground/40 bg-transparent'
                          )}
                          aria-hidden
                        />
                        <span className="truncate">{favSelectedMajor.name} (대분류만)</span>
                      </button>
                    </li>
                    {(favSubByParent.get(favSelectedMajor.id) || []).map((sub) => {
                      const catKey = `${favSelectedMajor.name} > ${sub.name}`;
                      const isFav = favoriteCategoryKeys.includes(catKey);
                      return (
                        <li key={sub.id}>
                          <button
                            type="button"
                            onClick={() => handleFavToggleKey(catKey)}
                            className="mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/80"
                          >
                            <span
                              className={cn(
                                'h-2 w-2 shrink-0 rounded-full',
                                isFav ? 'bg-[#14b8a6]' : 'border border-muted-foreground/40 bg-transparent'
                              )}
                              aria-hidden
                            />
                            <span className="truncate">{sub.name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-background px-6 py-4 sm:justify-between">
            <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={handleClearCategoryFavorites}>
              초기화
            </Button>
            <Button type="button" onClick={() => setCategoryFavDialogOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MemberProfileManageDialog
        open={profileManageOpen}
        onOpenChange={setProfileManageOpen}
        member={selectedMember}
        onSave={async (updates) => {
          if (!selectedMember?.id || !onUpdateMember) {
            toast.error('팀원을 선택하거나 저장할 수 없습니다.');
            throw new Error('skip');
          }
          try {
            await onUpdateMember(selectedMember.id, {
              avatar: updates.avatar || undefined,
              statusMessage: updates.statusMessage.trim() ? updates.statusMessage.trim() : null,
            });
            if (selectedTeamId) {
              recordMemberProfileSeen(selectedTeamId, selectedMember.id, {
                avatar: updates.avatar,
                statusMessage: updates.statusMessage,
              });
            }
            setProfileBaselineTick((t) => t + 1);
            toast.success('프로필이 저장되었습니다.');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '저장에 실패했습니다.');
            throw e;
          }
        }}
      />
    </aside>
  );
}

