import { useMemo, useState, useEffect, Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Users, BarChart3, Plus, Trash2, Edit2, X, Check, Target, Settings, Printer, Download, Layers, FileText, Filter, Search, LayoutList, LayoutGrid, PieChart as PieChartIcon, KeyRound, Shield, ArrowUp, ArrowDown, ArrowUpDown, Columns3 } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TeamMember, WorkLog, Category, WorkTeam, normalizeWorkIndicator, type WorkIndicatorType } from '@/types/workLog';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subYears } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { addDurations } from '@/utils/workLogNumeric';
import { clampCategoryName } from '@/utils/categoryNameLimit';
import { exportRecordsTableToExcel } from '@/utils/excelExport';
import { EffortIqrSignal } from '@/components/EffortIqrSignal';
import {
  filterLogsForEffort,
  buildMergedEffortUnits,
  aggregateByMajor,
  aggregateBySub,
  buildBaselineStatsMaps,
  collectPerCasesByMajor,
  collectPerCasesBySub,
  classifyPerCaseUpperIqrTiers,
  parseCategory,
  unitsForSubKey,
  unitsForMajor,
  logsForMergedUnit,
  unitPerCase,
} from '@/utils/effortCalculation';
import { toast } from 'sonner';
import { SummaryDashboardTab } from './SummaryDashboardTab';
import { PrintableReport } from './PrintableReport';
import { PersonalStatsDialog } from './PersonalStatsDialog';
import { TaskMergedDetailDialog } from '@/components/TaskMergedDetailDialog';
import { AdminPasswordSettingsTab } from './AdminPasswordSettingsTab';
import type { GlobalTeamAdminPreview } from '@/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '@/constants/adminPasswordChange';
import type { StoredSessionRole } from '@/utils/sessionKeys';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type AdminDashboardTab =
  | 'admin_home'
  | 'summary_dashboard'
  | 'statistics_category'
  | 'statistics_members'
  | 'records'
  | 'management_members'
  | 'management_categories'
  | 'management_admin_settings';

/** 관리자 셸(사이드바): 대시보드 탭 + 마스터 전용 탭 */
export type AdminShellTab = AdminDashboardTab | 'master' | 'audit';

type WorkIndicatorCountMap = Record<WorkIndicatorType, number>;

type MajorCategoryStatRow = {
  category: string;
  participantCount: number;
  taskCount: number;
  totalCount: number;
  hours: number;
};

type SubCategoryStatRow = {
  category: string;
  displayName: string;
  participantCount: number;
  taskCount: number;
  totalCount: number;
  hours: number;
};

type AdminPeriodStats = {
  totalHours: number;
  totalTasks: number;
  totalCount: number;
  workIndicatorCounts: WorkIndicatorCountMap;
  prevTotalHours: number;
  prevTotalTasks: number;
  prevTotalCount: number;
  categoryDetailStats: Array<{
    category: string;
    taskCount: number;
    totalCount: number;
    hours: number;
    workIndicator: WorkIndicatorCountMap;
  }>;
  majorCategoryStats: MajorCategoryStatRow[];
  subCategoryStatsByMajor: Record<string, SubCategoryStatRow[]>;
  memberStats: Array<{
    member: TeamMember;
    hours: number;
    taskCount: number;
    totalCount: number;
    workIndicatorCounts: WorkIndicatorCountMap;
  }>;
};

interface AdminDashboardProps {
  members: TeamMember[];
  teams: WorkTeam[];
  logs: WorkLog[];
  categories: string[];
  categoriesTree?: Category[];
  onAddMember: (member: Omit<TeamMember, 'id'>) => void;
  onUpdateMember: (id: string, updates: Partial<TeamMember>) => void;
  onDeleteMember: (id: string) => void;
  onUpdateCategories: (categories: string[]) => void;
  onUpdateCategoriesTree?: (categories: Category[]) => void;
  onImportData?: (data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }) => void;
  getDailyLeaveType?: (memberId: string, date: string) => Promise<string | null>;
  getDailyTotalWorkHours?: (memberId: string, date: string) => Promise<number>;
  activeTab: AdminDashboardTab;
  selectedTeamId: string | null;
  globalTeamAdminPreview: GlobalTeamAdminPreview;
  onChangeAdminPassword: (params: ChangeAdminPasswordSelfParams) => Promise<void>;
  /** 관리 홈 카드에서 다른 메뉴로 이동 */
  onAdminShellNavigate?: (tab: AdminShellTab) => void;
  sessionRole?: StoredSessionRole | null;
}

export function AdminDashboard({
  members,
  teams,
  logs,
  categories,
  categoriesTree = [],
  onAddMember,
  onUpdateMember,
  onDeleteMember,
  onUpdateCategories,
  onUpdateCategoriesTree,
  onImportData,
  getDailyLeaveType,
  getDailyTotalWorkHours,
  activeTab,
  selectedTeamId,
  globalTeamAdminPreview,
  onChangeAdminPassword,
  onAdminShellNavigate,
  sessionRole = null,
}: AdminDashboardProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [newMemberEmployeeNo, setNewMemberEmployeeNo] = useState('');
  const [pendingNewMembers, setPendingNewMembers] = useState<{ name: string; role: string; employeeNo?: string }[]>([]);
  const [editingCategories, setEditingCategories] = useState(false);
  const [categoryTreeList, setCategoryTreeList] = useState<Category[]>([]);
  const [newMajorName, setNewMajorName] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [newSubByParent, setNewSubByParent] = useState<Record<number, string>>({});
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState<'month' | 'year'>('month');
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());
  const [statsMonth, setStatsMonth] = useState(() => new Date().getMonth() + 1);
  const [statsMemberForDialog, setStatsMemberForDialog] = useState<TeamMember | null>(null);
  const [recordsMemberFilter, setRecordsMemberFilter] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setRecordsMemberFilter(prev => {
      const next = { ...prev };
      members.forEach(m => { if (next[m.id] === undefined) next[m.id] = true; });
      return next;
    });
  }, [members]);

  const selectedDate = useMemo(() => new Date(statsYear, statsMonth - 1, 1), [statsYear, statsMonth]);
  const periodStart = statsPeriod === 'month' ? startOfMonth(selectedDate) : startOfYear(selectedDate);
  const periodEnd = statsPeriod === 'month' ? endOfMonth(selectedDate) : endOfYear(selectedDate);
  const prevPeriodStart = statsPeriod === 'month' ? startOfMonth(subMonths(selectedDate, 1)) : startOfYear(subYears(selectedDate, 1));
  const prevPeriodEnd = statsPeriod === 'month' ? endOfMonth(subMonths(selectedDate, 1)) : endOfYear(subYears(selectedDate, 1));

  const stats = useMemo(() => {
    const safeCategories = categories || [];
    
    const periodLogs = logs.filter(
      (l) =>
        l.date >= format(periodStart, 'yyyy-MM-dd') &&
        l.date <= format(periodEnd, 'yyyy-MM-dd') &&
        l.status !== '취소'
    );

    const prevPeriodLogs = logs.filter(
      (l) =>
        l.date >= format(prevPeriodStart, 'yyyy-MM-dd') &&
        l.date <= format(prevPeriodEnd, 'yyyy-MM-dd') &&
        l.status !== '취소'
    );

    const totalHours = periodLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
    const totalTasks = periodLogs.length;
    const totalCount = periodLogs.reduce((sum, l) => sum + l.count, 0);
    const workIndicatorCounts: WorkIndicatorCountMap = {
      'R&R/루틴업무': 0,
      '현안대응': 0,
      '품질고도화 과제': 0,
      '조직운영관리': 0,
      '기타/행정': 0,
    };
    periodLogs.forEach((l) => {
      workIndicatorCounts[normalizeWorkIndicator(l.workIndicator)] += l.count;
    });

    const prevTotalHours = prevPeriodLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
    const prevTotalTasks = prevPeriodLogs.length;
    const prevTotalCount = prevPeriodLogs.reduce((sum, l) => sum + l.count, 0);

    // 업무분류별 상세 통계
    const categoryDetailStats = safeCategories.map((cat) => {
      const catLogs = periodLogs.filter((l) => l.category === cat);
      const catHours = catLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const catCount = catLogs.reduce((sum, l) => sum + l.count, 0);
      const catWorkIndicator: WorkIndicatorCountMap = {
        'R&R/루틴업무': 0,
        '현안대응': 0,
        '품질고도화 과제': 0,
        '조직운영관리': 0,
        '기타/행정': 0,
      };
      catLogs.forEach((l) => {
        catWorkIndicator[normalizeWorkIndicator(l.workIndicator)] += l.count;
      });
      return {
        category: cat,
        taskCount: catLogs.length,
        totalCount: catCount,
        hours: catHours,
        workIndicator: catWorkIndicator,
      };
    }).filter(s => s.taskCount > 0).sort((a, b) => b.hours - a.hours);

    // 대분류별 통계 (분류명, 실시자수, 전체소요시간, 전체건수, 비중)
    const majorNames = [...new Set(safeCategories.map(c => c.includes(' > ') ? c.split(' > ')[0]! : c))];
    const majorCategoryStats = majorNames.map((major) => {
      const catLogs = periodLogs.filter((l) => l.category === major || l.category.startsWith(major + ' > '));
      const catHours = catLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const participantCount = new Set(catLogs.map(l => l.memberId)).size;
      return {
        category: major,
        participantCount,
        taskCount: catLogs.length,
        totalCount: catLogs.reduce((sum, l) => sum + l.count, 0),
        hours: catHours,
      };
    }).filter(s => s.taskCount > 0).sort((a, b) => b.hours - a.hours);

    // 소분류별 통계 (대분류별로 그룹)
    const subCategoryStatsByMajor: Record<string, SubCategoryStatRow[]> = {};
    safeCategories.filter(c => c.includes(' > ')).forEach((cat) => {
      const [major, sub] = cat.split(' > ');
      if (!major || !sub) return;
      const catLogs = periodLogs.filter((l) => l.category === cat);
      if (catLogs.length === 0) return;
      const catHours = catLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const participantCount = new Set(catLogs.map(l => l.memberId)).size;
      if (!subCategoryStatsByMajor[major]) subCategoryStatsByMajor[major] = [];
      subCategoryStatsByMajor[major].push({
        category: cat,
        displayName: sub.trim(),
        participantCount,
        taskCount: catLogs.length,
        totalCount: catLogs.reduce((sum, l) => sum + l.count, 0),
        hours: catHours,
      });
    });
    Object.keys(subCategoryStatsByMajor).forEach(major => {
      subCategoryStatsByMajor[major].sort((a, b) => b.hours - a.hours);
    });

    // 팀원별 통계
    const memberStats = members.map((member) => {
      const memberLogs = periodLogs.filter((l) => l.memberId === member.id);
      const memberHours = memberLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const memberTasks = memberLogs.length;
      const memberTotalCount = memberLogs.reduce((sum, l) => sum + l.count, 0);
      const memberWorkIndicator: WorkIndicatorCountMap = {
        'R&R/루틴업무': 0,
        '현안대응': 0,
        '품질고도화 과제': 0,
        '조직운영관리': 0,
        '기타/행정': 0,
      };
      memberLogs.forEach((l) => {
        memberWorkIndicator[normalizeWorkIndicator(l.workIndicator)] += l.count;
      });
      return {
        member,
        hours: memberHours,
        taskCount: memberTasks,
        totalCount: memberTotalCount,
        workIndicatorCounts: memberWorkIndicator,
      };
    }).sort((a, b) => b.hours - a.hours);

    return {
      totalHours,
      totalTasks,
      totalCount,
      workIndicatorCounts,
      prevTotalHours,
      prevTotalTasks,
      prevTotalCount,
      categoryDetailStats,
      majorCategoryStats,
      subCategoryStatsByMajor,
      memberStats,
    };
  }, [logs, members, categories, periodStart, periodEnd, prevPeriodStart, prevPeriodEnd]);

  const handleAddMember = () => {
    if (newMemberName.trim() && newMemberRole.trim()) {
      const emp = newMemberEmployeeNo.trim();
      setPendingNewMembers((prev) => [
        ...prev,
        {
          name: newMemberName.trim(),
          role: newMemberRole.trim(),
          ...(emp ? { employeeNo: emp } : {}),
        },
      ]);
      setNewMemberName('');
      setNewMemberRole('');
      setNewMemberEmployeeNo('');
      setShowAddForm(false);
    }
  };

  const handleSavePendingMembers = async () => {
    if (pendingNewMembers.length === 0) return;
    for (const m of pendingNewMembers) {
      await onAddMember(m);
    }
    setPendingNewMembers([]);
    toast.success('저장되었습니다.');
  };

  const handleSaveCategories = async () => {
    if (onUpdateCategoriesTree) {
      await onUpdateCategoriesTree(categoryTreeList.length > 0 ? categoryTreeList : []);
    }
    setEditingCategories(false);
    toast.success('저장되었습니다.');
  };

  const handleAddMajorCategory = () => {
    const trimmed = clampCategoryName(newMajorName.trim());
    if (!trimmed) return;
    const maxId = Math.max(0, ...categoryTreeList.map(c => c.id));
    const newCat: Category = { id: maxId + 1, name: trimmed, parentId: null, sortOrder: categoryTreeList.filter(c => !c.parentId).length + 1 };
    setCategoryTreeList(prev => [...prev, newCat].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    setNewMajorName('');
  };

  const handleAddSubCategory = (parentId: number) => {
    const name = clampCategoryName(newSubByParent[parentId]?.trim() || newSubName.trim());
    if (!name) return;
    const maxId = Math.max(0, ...categoryTreeList.map(c => c.id));
    const subsOfParent = categoryTreeList.filter(c => c.parentId === parentId);
    const newCat: Category = { id: maxId + 1, name, parentId, sortOrder: subsOfParent.length + 1 };
    setCategoryTreeList(prev => [...prev, newCat].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    setNewSubByParent(prev => ({ ...prev, [parentId]: '' }));
    setNewSubName('');
  };

  const handleRemoveCategory = (id: number) => {
    setCategoryTreeList(prev => prev.filter(c => c.id !== id && c.parentId !== id));
  };

  const handleRenameCategory = (id: number, name: string) => {
    setCategoryTreeList((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: clampCategoryName(name) } : c))
    );
  };

  // 인쇄 미리보기 표시
  if (showPrintPreview) {
    return (
      <PrintableReport
        members={members}
        logs={logs}
        categories={categories}
        currentDate={periodStart}
        onClose={() => setShowPrintPreview(false)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-transparent overflow-hidden worklog-admin-scope">
      {statsMemberForDialog && (
        <PersonalStatsDialog
          open
          onOpenChange={(open) => !open && setStatsMemberForDialog(null)}
          member={statsMemberForDialog}
          logs={logs}
          categories={categories}
          currentDate={periodStart}
          periodOverride={{ start: periodStart, end: periodEnd }}
          getDailyLeaveType={getDailyLeaveType}
        />
      )}
      <header className="worklog-topbar shrink-0 z-20">
        <div className="flex w-full min-w-0 items-center gap-4">
          <h2 className="shrink-0 text-xl font-semibold tracking-tight text-[#1e293b]">
            {activeTab === 'admin_home'
              ? '관리 홈'
              : activeTab === 'summary_dashboard'
                ? '요약 대시보드'
              : activeTab === 'statistics_category'
                ? '업무 분류별 통계'
                : activeTab === 'statistics_members'
                  ? '팀원별 통계'
                  : '관리자 대시보드'}
          </h2>
        </div>
      </header>

      <div className="worklog-content-scroll space-y-6">
        {activeTab === 'admin_home' && onAdminShellNavigate && (
          <AdminHomePanel onNavigate={onAdminShellNavigate} sessionRole={sessionRole} />
        )}
        {activeTab === 'summary_dashboard' && (
          <SummaryDashboardTab
            members={members}
            teams={teams}
            logs={logs}
            statsPeriod={statsPeriod}
            statsYear={statsYear}
            statsMonth={statsMonth}
            setStatsPeriod={setStatsPeriod}
            setStatsYear={setStatsYear}
            setStatsMonth={setStatsMonth}
            getDailyTotalWorkHours={getDailyTotalWorkHours}
          />
        )}
        {activeTab === 'statistics_category' && (
          <StatisticsTab
            mode="category"
            stats={stats}
            categories={categories}
            members={members}
            logs={logs}
            onImportData={onImportData}
            currentDate={periodStart}
            onPrintReport={() => setShowPrintPreview(true)}
            onMemberClick={setStatsMemberForDialog}
            statsYear={statsYear}
            setStatsYear={setStatsYear}
            statsMonth={statsMonth}
            setStatsMonth={setStatsMonth}
            statsPeriod={statsPeriod}
            setStatsPeriod={setStatsPeriod}
          />
        )}
        {activeTab === 'statistics_members' && (
          <StatisticsTab
            mode="member"
            stats={stats}
            categories={categories}
            members={members}
            logs={logs}
            onImportData={onImportData}
            currentDate={periodStart}
            onPrintReport={() => setShowPrintPreview(true)}
            onMemberClick={setStatsMemberForDialog}
            statsYear={statsYear}
            setStatsYear={setStatsYear}
            statsMonth={statsMonth}
            setStatsMonth={setStatsMonth}
            statsPeriod={statsPeriod}
            setStatsPeriod={setStatsPeriod}
          />
        )}
        {activeTab === 'records' && (
          <RecordsTab
            members={members}
            logs={logs}
            recordsPeriod={statsPeriod}
            setRecordsPeriod={setStatsPeriod}
            recordsYear={statsYear}
            setRecordsYear={setStatsYear}
            recordsMonth={statsMonth}
            setRecordsMonth={setStatsMonth}
            recordsMemberFilter={recordsMemberFilter}
            setRecordsMemberFilter={setRecordsMemberFilter}
          />
        )}
        {activeTab === 'management_members' && (
          <TeamMembersManagementTab
            members={members}
            showAddForm={showAddForm}
            setShowAddForm={setShowAddForm}
            newMemberName={newMemberName}
            setNewMemberName={setNewMemberName}
            newMemberRole={newMemberRole}
            setNewMemberRole={setNewMemberRole}
            newMemberEmployeeNo={newMemberEmployeeNo}
            setNewMemberEmployeeNo={setNewMemberEmployeeNo}
            pendingNewMembers={pendingNewMembers}
            setPendingNewMembers={setPendingNewMembers}
            handleAddMember={handleAddMember}
            onUpdateMember={onUpdateMember}
            onDeleteMember={onDeleteMember}
            onSavePendingMembers={handleSavePendingMembers}
          />
        )}
        {activeTab === 'management_categories' && (
          <CategoriesManagementTab
            categoriesTree={categoriesTree}
            editingCategories={editingCategories}
            setEditingCategories={setEditingCategories}
            categoryTreeList={categoryTreeList}
            setCategoryTreeList={setCategoryTreeList}
            newMajorName={newMajorName}
            setNewMajorName={setNewMajorName}
            newSubName={newSubName}
            setNewSubName={setNewSubName}
            newSubByParent={newSubByParent}
            setNewSubByParent={setNewSubByParent}
            handleAddMajorCategory={handleAddMajorCategory}
            handleAddSubCategory={handleAddSubCategory}
            handleRemoveCategory={handleRemoveCategory}
            handleRenameCategory={handleRenameCategory}
            handleSaveCategories={handleSaveCategories}
            onLoadQACategories={
              onUpdateCategoriesTree
                ? async () => {
                    const { qaCategoriesToTree } = await import('@/data/qaCategories');
                    await onUpdateCategoriesTree(qaCategoriesToTree());
                  }
                : undefined
            }
          />
        )}
        {activeTab === 'management_admin_settings' && (
          <AdminPasswordSettingsTab
            selectedTeamId={selectedTeamId}
            teams={teams}
            globalTeamAdminPreview={globalTeamAdminPreview ?? { adminLoginId: null, hasPassword: false }}
            onChangePassword={onChangeAdminPassword}
            sessionRole={sessionRole}
          />
        )}
      </div>
    </div>
  );
}

/** 기록 탭 정렬 열 */
type RecordSortColumn =
  | 'taskCode'
  | 'member'
  | 'date'
  | 'major'
  | 'sub'
  | 'content'
  | 'issues'
  | 'count'
  | 'duration'
  | 'workIndicator'
  | 'status';

function getRecordSortComparable(
  log: WorkLog & { _sortDate?: string },
  col: RecordSortColumn,
  memberById: Map<string, TeamMember>,
  major: string,
  sub: string
): string | number {
  switch (col) {
    case 'taskCode':
      return log.taskCode ?? '';
    case 'member':
      return memberById.get(log.memberId)?.name ?? '';
    case 'date':
      return log._sortDate ?? log.date;
    case 'major':
      return major;
    case 'sub':
      return sub || '';
    case 'content':
      return log.content;
    case 'issues':
      return log.issues ?? '';
    case 'count':
      return log.count;
    case 'duration':
      return log.duration;
    case 'workIndicator':
      return log.workIndicator || '기타/행정';
    case 'status':
      return log.status;
    default:
      return '';
  }
}

// Records Tab - 전체 팀원 업무 기록 목록
function RecordsTab({
  members,
  logs,
  recordsPeriod,
  setRecordsPeriod,
  recordsYear,
  setRecordsYear,
  recordsMonth,
  setRecordsMonth,
  recordsMemberFilter,
  setRecordsMemberFilter,
}: {
  members: TeamMember[];
  logs: WorkLog[];
  recordsPeriod: 'month' | 'year';
  setRecordsPeriod: (v: 'month' | 'year') => void;
  recordsYear: number;
  setRecordsYear: (v: number) => void;
  recordsMonth: number;
  setRecordsMonth: (v: number) => void;
  recordsMemberFilter: Record<string, boolean>;
  setRecordsMemberFilter: (v: Record<string, boolean> | ((p: Record<string, boolean>) => Record<string, boolean>)) => void;
}) {
  const [showMemberFilterPopup, setShowMemberFilterPopup] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [showTaskCodeColumn, setShowTaskCodeColumn] = useState(false);
  const [sortColumn, setSortColumn] = useState<RecordSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [mergedTaskDetailLogs, setMergedTaskDetailLogs] = useState<WorkLog[] | null>(null);
  const [mergedTaskDetailMemberName, setMergedTaskDetailMemberName] = useState('');

  const recordsStart = recordsPeriod === 'month' ? new Date(recordsYear, recordsMonth - 1, 1) : new Date(recordsYear, 0, 1);
  const recordsEnd = recordsPeriod === 'month' ? endOfMonth(recordsStart) : endOfYear(recordsStart);
  const startStr = format(recordsStart, 'yyyy-MM-dd');
  const endStr = format(recordsEnd, 'yyyy-MM-dd');

  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  const filteredLogs = useMemo(() => {
    const visibleIds = new Set(members.filter(m => recordsMemberFilter[m.id] !== false).map(m => m.id));
    let result = logs
      .filter(l => l.date >= startStr && l.date <= endStr && visibleIds.has(l.memberId))
      .sort((a, b) => a.date.localeCompare(b.date) || a.memberId.localeCompare(b.memberId));

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter(log => {
        const [major, sub] = log.category.includes(' > ') ? log.category.split(' > ') : [log.category, ''];
        const member = memberById.get(log.memberId);
        const rowText = [log.taskCode ?? '', member?.name ?? '', log.date, major, sub, log.content, log.issues ?? '', String(log.count), String(log.duration), log.workIndicator, log.status].join(' ').toLowerCase();
        return rowText.includes(q);
      });
    }

    Object.entries(columnFilters).forEach(([col, values]) => {
      if (values.size === 0) return;
      result = result.filter(log => {
        const [major, sub] = log.category.includes(' > ') ? log.category.split(' > ') : [log.category, ''];
        const member = memberById.get(log.memberId);
        let val = '';
        if (col === '팀원') val = member?.name ?? '';
        else if (col === '날짜') val = log.date;
        else if (col === '대분류') val = major;
        else if (col === '소분류') val = sub || '-';
        else if (col === '업무내용') val = log.content;
        else if (col === '특이사항' || col === '이슈사항') val = log.issues ?? '-';
        else if (col === '건수') val = String(log.count);
        else if (col === '소요시간') val = String(log.duration);
        else if (col === '업무지표') val = log.workIndicator || '기타/행정';
        else if (col === '현황') val = log.status;
        return values.has(val);
      });
    });

    return result;
  }, [logs, members, recordsMemberFilter, startStr, endStr, searchText, columnFilters, memberById]);

  // 동일 taskCode(동일 업무 단위): 팀원·코드별 그룹화, 소요시간 합산(진행/완료 혼합)
  const displayLogs = useMemo(() => {
    const byTask = new Map<string, { logs: WorkLog[]; duration: number; dates: string[] }>();
    const noCode: WorkLog[] = [];
    filteredLogs.forEach(log => {
      if (!log.taskCode) {
        noCode.push(log);
        return;
      }
      const key = `${log.memberId}\t${log.taskCode}`;
      const existing = byTask.get(key);
      if (existing) {
        existing.logs.push(log);
        existing.duration = addDurations(existing.duration, log.duration);
        if (!existing.dates.includes(log.date)) existing.dates.push(log.date);
      } else {
        byTask.set(key, { logs: [log], duration: log.duration, dates: [log.date] });
      }
    });
    const groupedList = Array.from(byTask.values()).map(({ logs: taskLogs, duration, dates }) => {
      const sortedDates = [...dates].sort();
      const latest = [...taskLogs].sort((a, b) => b.date.localeCompare(a.date))[0];
      const hasInProgress = taskLogs.some(l => l.status === '진행중');
      const sortedTaskLogs = [...taskLogs].sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...latest,
        duration,
        date: sortedDates.length > 1 ? `${sortedDates[0]} 외 ${sortedDates.length - 1}일` : sortedDates[0],
        _sortDate: sortedDates[0],
        status: hasInProgress ? ('진행중' as const) : latest.status,
        _mergedTaskLogs: sortedTaskLogs,
      };
    });
    return [...groupedList, ...noCode].sort((a, b) => {
      const da = (a as { _sortDate?: string })._sortDate || a.date;
      const db = (b as { _sortDate?: string })._sortDate || b.date;
      return da.localeCompare(db) || a.memberId.localeCompare(b.memberId);
    });
  }, [filteredLogs]);

  const sortedDisplayLogs = useMemo(() => {
    if (!sortColumn) return displayLogs;
    return [...displayLogs].sort((a, b) => {
      const [majA, subA] = a.category.includes(' > ') ? a.category.split(' > ') : [a.category, ''];
      const [majB, subB] = b.category.includes(' > ') ? b.category.split(' > ') : [b.category, ''];
      const va = getRecordSortComparable(a as WorkLog & { _sortDate?: string }, sortColumn, memberById, majA, subA);
      const vb = getRecordSortComparable(b as WorkLog & { _sortDate?: string }, sortColumn, memberById, majB, subB);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), 'ko');
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [displayLogs, sortColumn, sortDirection, memberById]);

  const uniqueValues = useMemo(() => {
    const visibleIds = new Set(members.filter(m => recordsMemberFilter[m.id] !== false).map(m => m.id));
    const base = logs.filter(l => l.date >= startStr && l.date <= endStr && visibleIds.has(l.memberId));
    return {
      팀원: [...new Set(base.map(l => memberById.get(l.memberId)?.name ?? '-'))].sort(),
      대분류: [...new Set(base.map(l => (l.category.includes(' > ') ? l.category.split(' > ')[0] : l.category) ?? ''))].filter(Boolean).sort(),
      소분류: [...new Set(base.map(l => (l.category.includes(' > ') ? l.category.split(' > ')[1]?.trim() : '') || '-'))].sort(),
      업무지표: [...new Set(base.map(l => l.workIndicator || '기타/행정'))].sort(),
      현황: [...new Set(base.map(l => l.status))].sort(),
    };
  }, [logs, members, recordsMemberFilter, startStr, endStr, memberById]);

  const toggleColumnFilter = (col: string, value: string) => {
    setColumnFilters(prev => {
      const next = new Set(prev[col] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [col]: next };
    });
  };

  const clearColumnFilter = (col: string) => {
    setColumnFilters(prev => ({ ...prev, [col]: new Set() }));
  };

  const RecordsSortFilterHeader = ({
    label,
    columnSortId,
    filterCol,
    align = 'left',
  }: {
    label: string;
    columnSortId: RecordSortColumn;
    filterCol?: keyof typeof uniqueValues;
    align?: 'left' | 'center';
  }) => {
    const values = filterCol ? uniqueValues[filterCol] : undefined;
    const filterActive = filterCol ? (columnFilters[filterCol]?.size ?? 0) > 0 : false;
    const sortActive = sortColumn === columnSortId;
    const thAlign = align === 'center' ? 'text-center' : 'text-left';
    const btnJustify = align === 'center' ? 'justify-center w-full' : '';

    return (
      <th className={cn('px-3 py-2.5 text-sm font-semibold text-[#64748b]', thAlign)}>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md hover:text-[#1e293b] transition-colors',
                btnJustify,
                (sortActive || filterActive) && 'text-[#02a1c0]'
              )}
            >
              <span className="truncate">{label}</span>
              {sortActive ? (
                sortDirection === 'asc' ? (
                  <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )
              ) : (
                <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
              )}
              {filterCol && filterActive && <Filter className="h-3 w-3 shrink-0" aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2" align="start">
            <p className="text-sm font-semibold text-muted-foreground mb-1.5">정렬</p>
            <div className="grid grid-cols-2 gap-1 mb-2">
              <button
                type="button"
                className={cn(
                  'rounded-md px-2 py-1.5 text-sm font-medium',
                  sortColumn === columnSortId && sortDirection === 'asc' ? 'bg-primary/15 text-[#0f172a]' : 'bg-muted/50 hover:bg-muted/80'
                )}
                onClick={() => {
                  setSortColumn(columnSortId);
                  setSortDirection('asc');
                }}
              >
                오름차순
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md px-2 py-1.5 text-sm font-medium',
                  sortColumn === columnSortId && sortDirection === 'desc' ? 'bg-primary/15 text-[#0f172a]' : 'bg-muted/50 hover:bg-muted/80'
                )}
                onClick={() => {
                  setSortColumn(columnSortId);
                  setSortDirection('desc');
                }}
              >
                내림차순
              </button>
            </div>
            {filterCol && values && (
              <>
                <div className="flex justify-between items-center border-t border-border/60 pt-2 pb-1">
                  <span className="text-sm font-semibold text-muted-foreground">필터</span>
                  {(columnFilters[filterCol]?.size ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => clearColumnFilter(filterCol)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      초기화
                    </button>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {values.map((v) => (
                    <label key={String(v)} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={columnFilters[filterCol]?.has(v) ?? false}
                        onChange={() => toggleColumnFilter(filterCol, v)}
                        className="rounded"
                      />
                      {v || '(빈값)'}
                    </label>
                  ))}
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      </th>
    );
  };

  const handleExportRecords = () => {
    exportRecordsTableToExcel(sortedDisplayLogs, members, undefined, { omitTaskCode: !showTaskCodeColumn });
    toast.success('엑셀 파일이 다운로드되었습니다.');
  };

  return (
    <div className="space-y-6">
      <div className="worklog-day-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-2 mb-4 min-w-0">
          <div className="worklog-period-strip sm:min-w-0">
            <div className="flex shrink-0 gap-0.5 rounded-lg border border-black/[0.06] bg-white p-0.5">
              <button
                type="button"
                onClick={() => setRecordsPeriod('month')}
                className={cn(
                  'h-8 rounded-md px-2 py-0 text-sm',
                  recordsPeriod === 'month' ? 'bg-[#f1f5f9] text-[#1e293b] shadow-sm' : 'text-[#64748b]'
                )}
              >
                월간
              </button>
              <button
                type="button"
                onClick={() => setRecordsPeriod('year')}
                className={cn(
                  'h-8 rounded-md px-2 py-0 text-sm',
                  recordsPeriod === 'year' ? 'bg-[#f1f5f9] text-[#1e293b] shadow-sm' : 'text-[#64748b]'
                )}
              >
                연간
              </button>
            </div>
            <select
              value={recordsYear}
              onChange={(e) => setRecordsYear(Number(e.target.value))}
              className="worklog-toolbar-select"
              aria-label="연도"
            >
              {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            {recordsPeriod === 'month' && (
              <select
                value={recordsMonth}
                onChange={(e) => setRecordsMonth(Number(e.target.value))}
                className="worklog-toolbar-select worklog-toolbar-select-month"
                aria-label="월"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowMemberFilterPopup(true)}
              className="worklog-btn-secondary py-1.5 text-sm"
            >
              <Users className="h-4 w-4" />
              팀원 선택
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="worklog-btn-secondary py-1.5 text-sm">
                  <Columns3 className="h-4 w-4" />
                  항목 선택
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-3" align="start">
                <p className="text-sm font-semibold text-muted-foreground mb-2">표시할 열</p>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={showTaskCodeColumn}
                    onChange={(e) => setShowTaskCodeColumn(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span className="font-mono text-sm">taskCode</span>
                  <span className="text-sm text-muted-foreground">(동일 업무 연결 ID)</span>
                </label>
              </PopoverContent>
            </Popover>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              <input
                type="text"
                placeholder="검색..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="worklog-form-control w-40 py-1.5 pl-8 pr-3 text-sm"
              />
            </div>
            <button type="button" onClick={handleExportRecords} className="worklog-btn-primary py-1.5 text-sm">
              <Download className="h-4 w-4" />
              엑셀 추출하기
            </button>
          </div>
        </div>

        <Dialog open={showMemberFilterPopup} onOpenChange={setShowMemberFilterPopup}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">팀원 선택</DialogTitle>
            </DialogHeader>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setRecordsMemberFilter(members.reduce((acc, m) => ({ ...acc, [m.id]: true }), {}))}
                className="worklog-btn-secondary flex-1 py-1.5 text-sm"
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={() => setRecordsMemberFilter(members.reduce((acc, m) => ({ ...acc, [m.id]: false }), {}))}
                className="worklog-btn-secondary flex-1 py-1.5 text-sm"
              >
                전체 해제
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={recordsMemberFilter[m.id] !== false} onChange={(e) => setRecordsMemberFilter(prev => ({ ...prev, [m.id]: e.target.checked }))} className="rounded border-border" />
                  <span className="text-sm">{m.name}</span>
                </label>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <div className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-xl border border-black/[0.06]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-[#f8fafc]/95 backdrop-blur">
              <tr className="border-b border-black/[0.06] bg-[#f1f5f9]/80">
                {showTaskCodeColumn && (
                  <RecordsSortFilterHeader label="taskCode" columnSortId="taskCode" />
                )}
                <RecordsSortFilterHeader label="팀원" columnSortId="member" filterCol="팀원" />
                <RecordsSortFilterHeader label="날짜" columnSortId="date" />
                <RecordsSortFilterHeader label="대분류" columnSortId="major" filterCol="대분류" />
                <RecordsSortFilterHeader label="소분류" columnSortId="sub" filterCol="소분류" />
                <RecordsSortFilterHeader label="업무내용" columnSortId="content" />
                <RecordsSortFilterHeader label="특이사항" columnSortId="issues" />
                <RecordsSortFilterHeader label="건수" columnSortId="count" align="center" />
                <RecordsSortFilterHeader label="소요시간" columnSortId="duration" align="center" />
                <RecordsSortFilterHeader label="업무지표" columnSortId="workIndicator" filterCol="업무지표" />
                <RecordsSortFilterHeader label="현황" columnSortId="status" filterCol="현황" />
              </tr>
            </thead>
            <tbody>
              {sortedDisplayLogs.map((log) => {
                const [major, sub] = log.category.includes(' > ') ? log.category.split(' > ') : [log.category, ''];
                const member = memberById.get(log.memberId);
                const rowKey = log.taskCode ? `${log.memberId}-${log.taskCode}` : log.id;
                const isMergedTask =
                  Boolean(log.taskCode) && typeof log.date === 'string' && log.date.includes('외') && log.date.includes('일');
                return (
                  <tr key={rowKey} className="border-b border-black/[0.06] hover:bg-[#f8fafc]/80">
                    {showTaskCodeColumn && (
                      <td className="max-w-[240px] px-3 py-2 break-all text-sm font-mono text-[#64748b]">
                        {log.taskCode ?? '—'}
                      </td>
                    )}
                    <td className="px-3 py-2 text-sm font-medium">{member?.name ?? '-'}</td>
                    <td className="px-3 py-2 text-sm">
                      {isMergedTask ? (
                        <button
                          type="button"
                          className="max-w-full text-left text-[#02a1c0] font-medium underline-offset-2 hover:underline whitespace-nowrap"
                          onClick={() => {
                            setMergedTaskDetailMemberName(member?.name ?? '');
                            setMergedTaskDetailLogs((log as WorkLog & { _mergedTaskLogs?: WorkLog[] })._mergedTaskLogs ?? []);
                          }}
                        >
                          {log.date}
                        </button>
                      ) : (
                        <span className="text-[#64748b] whitespace-nowrap tabular-nums">{log.date}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">{major}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{sub || '-'}</td>
                    <td className="px-3 py-2 text-sm">{log.content}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{log.issues || '-'}</td>
                    <td className="px-3 py-2 text-sm text-center">{log.count}</td>
                    <td
                      className="px-3 py-2 text-sm text-center tabular-nums"
                      title={
                        isMergedTask
                          ? '동일 taskCode로 이어진 여러 날의 소요시간을 합산한 값입니다.'
                          : undefined
                      }
                    >
                      {log.duration}h
                    </td>
                    <td className="px-3 py-2 text-sm text-center">{log.workIndicator || '기타/행정'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-sm font-medium whitespace-nowrap",
                        log.status === '완료' ? "bg-green-500/10 text-green-600" :
                        log.status === '진행중' ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"
                      )}>{log.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 space-y-1">
          <p className="text-sm text-muted-foreground">총 {sortedDisplayLogs.length}건</p>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">
            <strong className="font-medium text-foreground/90">소요시간 합산:</strong>{' '}
            같은 팀원·같은 taskCode(이어하기로 연결된 한 업무)로 묶인 행은 여러 날짜에 기록된 소요시간을 더해 한 행으로 보여 줍니다. 공수·총 작업시간 파악에 활용할 수 있습니다.
            taskCode가 없는(과거 데이터 등) 행은 일자별로 그대로 표시됩니다.
          </p>
        </div>
      </div>

      <TaskMergedDetailDialog
        open={mergedTaskDetailLogs !== null && mergedTaskDetailLogs.length > 0}
        onOpenChange={(o) => {
          if (!o) setMergedTaskDetailLogs(null);
        }}
        logs={mergedTaskDetailLogs}
        memberName={mergedTaskDetailMemberName}
        title="일자별 업무 기록"
      />
    </div>
  );
}

/** 관리 홈: 메뉴를 정사각형 카드 그리드로 표시 */
function AdminHomePanel({
  onNavigate,
  sessionRole,
}: {
  onNavigate: (tab: AdminShellTab) => void;
  sessionRole: StoredSessionRole | null;
}) {
  const items: { tab: AdminShellTab; label: string; description: string; icon: LucideIcon }[] = [
    { tab: 'summary_dashboard', label: '요약 대시보드', description: '팀·가동·부하', icon: LayoutGrid },
    { tab: 'statistics_category', label: '업무 분류별 통계', description: '대·소분류·지표별 집계', icon: Layers },
    { tab: 'statistics_members', label: '팀원별 통계', description: '팀원·도넛·세부 분석', icon: Users },
    { tab: 'records', label: '기록 조회', description: '팀 업무 기록 조회', icon: FileText },
    { tab: 'management_members', label: '팀원 관리', description: '팀원 추가·수정', icon: Users },
    { tab: 'management_categories', label: '업무 분류 관리', description: '대·소분류 편집', icon: Layers },
  ];
  if (sessionRole === 'admin' || sessionRole === 'director') {
    items.push({ tab: 'management_admin_settings', label: '관리자 설정', description: '비밀번호 등', icon: KeyRound });
  }
  if (sessionRole === 'master') {
    items.push({ tab: 'master', label: '마스터 관리', description: '팀·계정 전역', icon: Shield });
    items.push({ tab: 'audit', label: '감사 로그', description: 'DB 변경 이력 (50개)', icon: FileText });
  }

  return (
    <div className="flex flex-col gap-3 text-left">
      <p className="text-sm text-[#64748b] leading-relaxed">
        자주 쓰는 메뉴로 바로 이동할 수 있습니다.
      </p>
      <div className="grid w-full grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-3">
        {items.map(({ tab, label, description, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onNavigate(tab)}
            className={cn(
              'group flex w-full aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-2 py-2 text-center shadow-sm transition-all duration-200 min-w-0',
              'hover:border-[#02a1c0]/35 hover:shadow-[0_6px_20px_-8px_rgba(2,161,192,0.22)] hover:bg-[#f8fafc]/90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02a1c0]/40'
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(2,161,192,0.1)] text-[#02a1c0] transition-colors group-hover:bg-[rgba(2,161,192,0.16)]">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <span className="text-sm font-semibold leading-tight text-[#1e293b] line-clamp-2 px-0.5">{label}</span>
            <span className="line-clamp-2 text-xs leading-snug text-[#64748b] px-0.5">{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 공수 계산과 동일 스코프(filterLogsForEffort) 로그 기준 참여자 목록 */
function participantEntriesForMajor(
  logs: WorkLog[],
  members: TeamMember[],
  major: string
): { id: string; name: string }[] {
  const ids = new Set<string>();
  for (const l of logs) {
    if (parseCategory(l.category).major === major) ids.add(l.memberId);
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  return [...ids]
    .map((id) => ({ id, name: byId.get(id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function participantEntriesForExactCategory(
  logs: WorkLog[],
  members: TeamMember[],
  exactCategory: string
): { id: string; name: string }[] {
  const ids = new Set<string>();
  for (const l of logs) {
    if (l.category === exactCategory) ids.add(l.memberId);
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  return [...ids]
    .map((id) => ({ id, name: byId.get(id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** Fitness Energy 카드형 수직 막대 — 팀로그 톤, 건수·대비 강조 (부모가 flex-1이면 막대 트랙이 높이를 채움) */
function WorkIndicatorEnergyBars({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(0, ...data.map((d) => d.count));
  return (
    <div className="flex min-h-0 flex-1 gap-1.5 sm:gap-2">
      {data.map((d) => {
        const isPeak = max > 0 && d.count === max;
        const t = max > 0 ? d.count / max : 0;
        const barH = d.count > 0 ? 22 + t * 78 : 6;
        return (
          <div
            key={d.name}
            className="flex min-h-0 min-w-0 flex-1 flex-col justify-end gap-1"
            title={`${d.name} · ${d.count.toLocaleString('ko-KR')}건`}
          >
            <div className="flex min-h-[5.5rem] w-full flex-1 flex-col justify-end sm:min-h-[6.25rem]">
              <div
                className={cn(
                  'w-full min-h-[4px] rounded-sm transition-[height,box-shadow] duration-200',
                  isPeak
                    ? 'bg-[#02a1c0] shadow-[0_0_12px_rgba(2,161,192,0.35)]'
                    : 'bg-slate-300/90 hover:bg-slate-400/90 dark:bg-slate-600/80 dark:hover:bg-slate-500/80'
                )}
                style={{ height: `${barH}%` }}
              />
            </div>
            <p
              className={cn(
                'text-center tabular-nums text-[11px] font-semibold leading-none tracking-tight sm:text-xs',
                isPeak ? 'text-[#02a1c0]' : 'text-[#475569] dark:text-slate-300'
              )}
            >
              {d.count.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[9px] font-medium text-[#94a3b8] dark:text-slate-500">건</span>
            </p>
            <span className="line-clamp-2 text-center text-[8px] font-medium leading-snug text-[#64748b] break-keep sm:text-[9px] dark:text-slate-400">
              {d.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Statistics Tab (사이드바에서 업무 분류별 / 팀원별 메뉴로 구분)
function StatisticsTab({ mode, stats, categories, members, logs, onImportData, currentDate, onPrintReport, onMemberClick, statsYear, setStatsYear, statsMonth, setStatsMonth, statsPeriod, setStatsPeriod }: {
  mode: 'category' | 'member';
  stats: AdminPeriodStats;
  categories: string[];
  members: TeamMember[];
  logs: WorkLog[];
  onImportData?: (data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }) => void;
  currentDate: Date;
  onPrintReport: () => void;
  onMemberClick?: (member: TeamMember) => void;
  statsYear: number;
  setStatsYear: (v: number) => void;
  statsMonth: number;
  setStatsMonth: (v: number) => void;
  statsPeriod: 'month' | 'year';
  setStatsPeriod: (v: 'month' | 'year') => void;
}) {
  const [statsViewMode, setStatsViewMode] = useState<'text' | 'chart'>('text');
  const [selectedMajorForSub, setSelectedMajorForSub] = useState<string | null>(null);
  const [chartDetailMember, setChartDetailMember] = useState<TeamMember | null>(null);
  const [memberDetailMajor, setMemberDetailMajor] = useState<string | null>(null);
  const [categoryEffortSheet, setCategoryEffortSheet] = useState<
    null | { kind: 'major'; major: string } | { kind: 'sub'; major: string; sub: string }
  >(null);
  /** 업무 단위 행 키 — 상세 펼침 위치 */
  const [categoryEffortExpandedUnitKey, setCategoryEffortExpandedUnitKey] = useState<string | null>(null);

  const memberNameById = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  useEffect(() => {
    setCategoryEffortExpandedUnitKey(null);
  }, [categoryEffortSheet]);

  useEffect(() => {
    if (mode !== 'category') {
      setCategoryEffortSheet(null);
      setCategoryEffortExpandedUnitKey(null);
    }
  }, [mode]);

  useEffect(() => {
    const majors = (stats.majorCategoryStats || []).map((m) => m.category);
    if (majors.length > 0 && !selectedMajorForSub) setSelectedMajorForSub(majors[0]);
    if (majors.length > 0 && selectedMajorForSub && !majors.includes(selectedMajorForSub)) setSelectedMajorForSub(majors[0]);
  }, [stats.majorCategoryStats]);

  useEffect(() => {
    if (statsViewMode !== 'chart') setChartDetailMember(null);
  }, [statsViewMode]);

  useEffect(() => {
    setChartDetailMember(null);
  }, [statsYear, statsMonth, statsPeriod]);

  const periodBounds = useMemo(() => {
    const selectedDate = new Date(statsYear, statsMonth - 1, 1);
    const start = statsPeriod === 'month' ? startOfMonth(selectedDate) : startOfYear(selectedDate);
    const end = statsPeriod === 'month' ? endOfMonth(selectedDate) : endOfYear(selectedDate);
    return { start, end };
  }, [statsYear, statsMonth, statsPeriod]);

  /** 공수 계산 탭과 동일 규칙: taskCode 유닛·기준건당(중앙값)·IQR 상태 */
  const categoryEffortSnapshot = useMemo(() => {
    const ds = format(periodBounds.start, 'yyyy-MM-dd');
    const de = format(periodBounds.end, 'yyyy-MM-dd');
    const teamMemberIds = new Set(members.map((m) => m.id));
    const filteredLogs = filterLogsForEffort(logs, teamMemberIds, ds, de, {
      excludeCancelled: true,
      excludeInProgress: false,
    });
    const units = buildMergedEffortUnits(filteredLogs);
    const { byMajor: baselineByMajor, bySub: baselineBySub } = buildBaselineStatsMaps(units, 'median');
    const perCaseByMajor = collectPerCasesByMajor(units);
    const perCaseBySubKey = collectPerCasesBySub(units);
    const majorRows = aggregateByMajor(units, filteredLogs, {});
    const subRows = aggregateBySub(units, filteredLogs, {});
    const majorRowByName = new Map(majorRows.map((r) => [r.major, r]));
    const subRowByKey = new Map(subRows.map((r) => [r.key, r]));
    return {
      filteredLogs,
      units,
      baselineByMajor,
      baselineBySub,
      perCaseByMajor,
      perCaseBySubKey,
      majorRowByName,
      subRowByKey,
    };
  }, [logs, members, periodBounds]);

  const memberPeriodLogs = useMemo(() => {
    if (!chartDetailMember) return [];
    const ds = format(periodBounds.start, 'yyyy-MM-dd');
    const de = format(periodBounds.end, 'yyyy-MM-dd');
    return logs.filter((l) => l.memberId === chartDetailMember.id && l.date >= ds && l.date <= de);
  }, [chartDetailMember, logs, periodBounds]);

  /** 로그의 category 문자열만으로 집계 (전역 categories 목록과 불일치해도 표시됨) */
  const memberMajorPieData = useMemo(() => {
    if (!chartDetailMember || memberPeriodLogs.length === 0) return [];
    const byMajor = new Map<string, number>();
    for (const l of memberPeriodLogs) {
      const c = l.category || '';
      const major = c.includes(' > ') ? c.split(' > ')[0]!.trim() : c.trim();
      if (!major) continue;
      byMajor.set(major, addDurations(byMajor.get(major) ?? 0, l.duration));
    }
    return [...byMajor.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [chartDetailMember, memberPeriodLogs]);

  const WI_KEYS = ['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'] as const;
  const memberWiPieData = useMemo(() => {
    if (!chartDetailMember || memberPeriodLogs.length === 0) return [];
    return WI_KEYS.map((w) => ({
      name: w,
      value: memberPeriodLogs
        .filter((l) => (l.workIndicator || '기타/행정') === w)
        .reduce((s, l) => addDurations(s, l.duration), 0),
    })).filter((x) => x.value > 0);
  }, [chartDetailMember, memberPeriodLogs]);

  const memberSubPieData = useMemo(() => {
    if (!chartDetailMember || !memberDetailMajor || memberPeriodLogs.length === 0) return [];
    const bySub = new Map<string, number>();
    const prefix = `${memberDetailMajor} > `;
    for (const l of memberPeriodLogs) {
      const c = l.category || '';
      if (!c.startsWith(prefix)) continue;
      const sub = c.slice(prefix.length).trim() || memberDetailMajor;
      bySub.set(sub, addDurations(bySub.get(sub) ?? 0, l.duration));
    }
    return [...bySub.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [chartDetailMember, memberDetailMajor, memberPeriodLogs]);

  useEffect(() => {
    if (!chartDetailMember) {
      setMemberDetailMajor(null);
      return;
    }
    const first = memberMajorPieData[0]?.name ?? null;
    setMemberDetailMajor((prev) => {
      if (prev && memberMajorPieData.some((m) => m.name === prev)) return prev;
      return first;
    });
  }, [chartDetailMember, memberMajorPieData]);

  const pieColors = ['#02a1c0', '#22c55e', '#f59e0b', '#ec4899', '#4ec8dc', '#8b5cf6', '#f97316', '#6dd4e8'];
  const workIndicatorBarData = useMemo(() => {
    const wi = stats.workIndicatorCounts as Record<string, number> | undefined;
    return WI_KEYS.map((w) => ({ name: w, count: wi?.[w] ?? 0 }));
  }, [stats.workIndicatorCounts]);
  const majorPieData = (stats.majorCategoryStats || []).map((m: { category: string; hours: number }) => ({
    name: m.category,
    value: m.hours,
  }));
  const subPieSource =
    selectedMajorForSub && stats.subCategoryStatsByMajor?.[selectedMajorForSub]
      ? stats.subCategoryStatsByMajor[selectedMajorForSub]
      : [];
  const subPieData = subPieSource.map(
    (s: { displayName: string; hours: number }) => ({ name: s.displayName, value: s.hours })
  );

  return (
    <div className="space-y-6">
      {/* 툴바: [텍스트|도넛] → [월간|연간] → [연도·월] — 보고서 */}
      <div className="worklog-toolbar">
        <div className="worklog-period-strip">
          <div className="flex shrink-0 gap-0.5 rounded-lg border border-black/[0.06] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setStatsViewMode('text')}
              className={cn(
                'flex h-8 items-center gap-1 rounded-md px-2 py-0 text-sm transition-colors',
                statsViewMode === 'text'
                  ? 'bg-[#f1f5f9] text-[#1e293b] shadow-sm'
                  : 'text-[#64748b] hover:text-[#1e293b]'
              )}
            >
              <LayoutList className="w-3.5 h-3.5 shrink-0" />
              텍스트
            </button>
            <button
              type="button"
              onClick={() => setStatsViewMode('chart')}
              className={cn(
                'flex h-8 items-center gap-1 rounded-md px-2 py-0 text-sm transition-colors',
                statsViewMode === 'chart'
                  ? 'bg-[#f1f5f9] text-[#1e293b] shadow-sm'
                  : 'text-[#64748b] hover:text-[#1e293b]'
              )}
            >
              <PieChartIcon className="w-3.5 h-3.5 shrink-0" />
              도넛
            </button>
          </div>
          <div className="flex shrink-0 gap-0.5 rounded-lg border border-black/[0.06] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setStatsPeriod('month')}
              className={cn(
                'h-8 rounded-md px-2 py-0 text-sm',
                statsPeriod === 'month' ? 'bg-[#f1f5f9] text-[#1e293b] shadow-sm' : 'text-[#64748b]'
              )}
            >
              월간
            </button>
            <button
              type="button"
              onClick={() => setStatsPeriod('year')}
              className={cn(
                'h-8 rounded-md px-2 py-0 text-sm',
                statsPeriod === 'year' ? 'bg-[#f1f5f9] text-[#1e293b] shadow-sm' : 'text-[#64748b]'
              )}
            >
              연간
            </button>
          </div>
          <select
            value={statsYear}
            onChange={(e) => setStatsYear(Number(e.target.value))}
            className="worklog-toolbar-select"
            aria-label="연도"
          >
            {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          {statsPeriod === 'month' && (
            <select
              value={statsMonth}
              onChange={(e) => setStatsMonth(Number(e.target.value))}
              className="worklog-toolbar-select worklog-toolbar-select-month"
              aria-label="월"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
          )}
        </div>
        <button type="button" onClick={onPrintReport} className="worklog-btn-primary worklog-btn-toolbar shrink-0">
          <Printer className="h-3.5 w-3.5" />
          보고서
        </button>
      </div>

      {mode === 'category' && (
      <>
      {/* 핵심 지표: 총 시간 25% · 총 건수 25% · 업무 지표 막대 50% — md+ 동일 행 높이(stretch) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-stretch">
        <div className="stat-card flex min-h-0 flex-col items-center justify-center py-3 text-center md:col-span-3 md:h-full">
          <p className="text-xs font-medium text-[#64748b]">총 업무시간</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#02a1c0]">
            {stats.totalHours.toFixed(1)}
            <span className="text-base font-medium text-[#94a3b8] ml-0.5">h</span>
          </p>
          <p className="mt-0.5 text-[11px] text-[#94a3b8]">취소 제외 · 기록 소요 합</p>
        </div>
        <div className="stat-card flex min-h-0 flex-col items-center justify-center py-3 text-center md:col-span-3 md:h-full">
          <p className="text-xs font-medium text-[#64748b]">총 업무건수</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1e293b]">{stats.totalCount}</p>
          <p className="mt-0.5 text-[11px] text-[#94a3b8]" title="기간 내 로그(취소 제외)의 건수란 합계">
            각 행 건수 합계
          </p>
        </div>
        <div className="section-card flex min-h-0 min-w-0 flex-col py-3 px-3 sm:px-4 md:col-span-6 md:h-full">
          <div className="flex shrink-0 min-w-0 items-center gap-2">
            <Layers className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1e293b] dark:text-foreground">업무 지표 분류</p>
              <p className="text-[11px] text-[#94a3b8] dark:text-muted-foreground">기간 내 건수란 합 · 지표별</p>
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-2">
            <WorkIndicatorEnergyBars data={workIndicatorBarData} />
          </div>
        </div>
      </div>

      {statsViewMode === 'text' ? (
        <>
      {/* 업무분류별 현황 — 대분류 전체 너비 → 소분류 하단 전체 너비 */}
      <div className="flex flex-col gap-4">
        {/* 대분류 섹션 */}
        <div className="section-card flex min-h-[280px] flex-col">
          <div className="section-header">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">대분류별 현황</h3>
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto p-3 sm:p-5">
            <table className="w-full min-w-[68rem] table-auto text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground sm:px-3">분류</th>
                  <th className="px-1 py-2 text-center font-semibold text-muted-foreground" title="실시자 수">
                    인원
                  </th>
                  <th className="px-1 py-2 text-center font-semibold text-muted-foreground">시간 합계</th>
                  <th
                    className="px-1 py-2 text-center font-semibold text-muted-foreground whitespace-normal leading-snug"
                    title="업무건수(건수란 합) ÷ 시간 합계(h)"
                  >
                    시간당 처리 건수
                  </th>
                  <th className="px-1 py-2 text-center font-semibold text-muted-foreground">비중</th>
                  <th
                    className="px-1 py-2 text-center font-semibold text-muted-foreground whitespace-normal leading-snug"
                    title="같은 대분류 내 유닛별 건당 소요(h)의 중앙값 — 공수 계산과 동일"
                  >
                    건당 소요 공수 중앙값(h)
                  </th>
                  <th
                    className="px-1 py-2 text-center font-semibold text-muted-foreground"
                    title="집계 행 건당(h)이 같은 대분류 내 건당 분포 대비 IQR 상단 꼬리에 해당하는지"
                  >
                    상태
                  </th>
                  <th
                    className="px-1 py-2 text-center font-semibold text-muted-foreground"
                    title="해당 분류 로그의 건수란 합계(각 행 건수 합계)"
                  >
                    업무건수
                  </th>
                </tr>
              </thead>
              <tbody>
                {(stats.majorCategoryStats || []).map(({ category, participantCount, hours, totalCount: itemTotalCount }) => {
                  const percentage = stats.totalHours > 0 ? (hours / stats.totalHours) * 100 : 0;
                  const isSelected = selectedMajorForSub === category;
                  const mRow = categoryEffortSnapshot.majorRowByName.get(category);
                  const tier = classifyPerCaseUpperIqrTiers(
                    mRow?.perCase ?? null,
                    categoryEffortSnapshot.perCaseByMajor.get(category) ?? []
                  );
                  const baseStat = categoryEffortSnapshot.baselineByMajor.get(category);
                  const perHour =
                    hours > 0 && Number.isFinite(hours)
                      ? ((itemTotalCount ?? 0) / hours).toFixed(2)
                      : null;
                  return (
                    <tr
                      key={category}
                      onClick={() => setSelectedMajorForSub(category)}
                      className={cn(
                        "border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer",
                        isSelected && "bg-primary/10"
                      )}
                    >
                    <td className="max-w-md px-2 py-1.5 text-center font-medium sm:px-3" title={category}>
                      <span className="line-clamp-2">{category}</span>
                    </td>
                    <td className="px-1 py-1.5 text-center tabular-nums">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline tabular-nums"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {participantCount}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72" align="center" onClick={(e) => e.stopPropagation()}>
                          <p className="text-xs font-semibold text-foreground mb-2">참여 인원 ({participantCount}명)</p>
                          <ul className="text-sm text-muted-foreground space-y-1 max-h-56 overflow-y-auto">
                            {participantEntriesForMajor(
                              categoryEffortSnapshot.filteredLogs,
                              members,
                              category
                            ).map(({ id, name }) => (
                              <li key={id}>{name}</li>
                            ))}
                          </ul>
                        </PopoverContent>
                      </Popover>
                    </td>
                    <td className="px-1 py-1.5 text-center font-semibold text-primary tabular-nums whitespace-nowrap">
                      {hours.toFixed(1)}h
                    </td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-muted-foreground whitespace-nowrap">
                      {perHour != null ? `${perHour}건/h` : '—'}
                    </td>
                    <td className="px-1 py-1.5 align-middle">
                        <div className="flex min-w-0 items-center justify-center gap-1.5">
                          <div className="h-1.5 w-9 shrink-0 overflow-hidden rounded-full bg-muted sm:h-2 sm:w-11">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
                          </div>
                          <span className="min-w-[2.25rem] shrink-0 text-center tabular-nums text-muted-foreground">
                            {percentage.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-[#0f766e] whitespace-nowrap">
                      {baseStat?.baselinePerCase != null ? baseStat.baselinePerCase.toFixed(2) : '—'}
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      <EffortIqrSignal tier={tier} />
                    </td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-muted-foreground">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline tabular-nums"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategoryEffortSheet({ kind: 'major', major: category });
                        }}
                      >
                        {itemTotalCount ?? 0}
                      </button>
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 소분류 섹션 — 대분류 행 클릭 시 해당 대분류의 소분류 */}
        <div className="section-card flex min-h-[280px] flex-col">
          <div className="section-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="text-sm font-semibold">소분류별 현황</h3>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-md sm:flex-row sm:items-center sm:gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">대분류</span>
              <Select
                value={selectedMajorForSub ?? undefined}
                onValueChange={(v) => setSelectedMajorForSub(v)}
              >
                <SelectTrigger className="worklog-toolbar-select h-9 w-full min-w-[12rem] border-black/[0.08] text-sm sm:w-[min(22rem,100%)]">
                  <SelectValue placeholder="대분류 선택" />
                </SelectTrigger>
                <SelectContent>
                  {(stats.majorCategoryStats || []).map((m: { category: string }) => (
                    <SelectItem key={m.category} value={m.category}>
                      {m.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto p-3 sm:p-5">
            {selectedMajorForSub && stats.subCategoryStatsByMajor?.[selectedMajorForSub] ? (
              <table className="w-full min-w-[68rem] table-auto text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="px-2 py-2 text-center font-semibold text-muted-foreground sm:px-3">분류</th>
                    <th className="px-1 py-2 text-center font-semibold text-muted-foreground" title="실시자 수">
                      인원
                    </th>
                    <th className="px-1 py-2 text-center font-semibold text-muted-foreground">시간 합계</th>
                    <th
                      className="px-1 py-2 text-center font-semibold text-muted-foreground whitespace-normal leading-snug"
                      title="업무건수(건수란 합) ÷ 시간 합계(h)"
                    >
                      시간당 처리 건수
                    </th>
                    <th className="px-1 py-2 text-center font-semibold text-muted-foreground">비중</th>
                    <th
                      className="px-1 py-2 text-center font-semibold text-muted-foreground whitespace-normal leading-snug"
                      title="같은 소분류 내 유닛별 건당 소요(h)의 중앙값 — 공수 계산과 동일"
                    >
                      건당 소요 공수 중앙값(h)
                    </th>
                    <th
                      className="px-1 py-2 text-center font-semibold text-muted-foreground"
                      title="집계 행 건당(h)이 같은 소분류 내 건당 분포 대비 IQR 상단 꼬리에 해당하는지"
                    >
                      상태
                    </th>
                    <th
                      className="px-1 py-2 text-center font-semibold text-muted-foreground"
                      title="해당 소분류 로그의 건수란 합계(각 행 건수 합계)"
                    >
                      업무건수
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.subCategoryStatsByMajor[selectedMajorForSub].map(
                    ({ category: fullCategory, displayName, participantCount, hours, totalCount: itemTotalCount }) => {
                    const majorHours =
                      (stats.majorCategoryStats || []).find((m) => m.category === selectedMajorForSub)?.hours || 1;
                    const percentage = majorHours > 0 ? (hours / majorHours) * 100 : 0;
                    const { major: emajor, sub: esub } = parseCategory(fullCategory || '');
                    const subKey = `${emajor}\t${esub ?? '-'}`;
                    const sRow = categoryEffortSnapshot.subRowByKey.get(subKey);
                    const tier = classifyPerCaseUpperIqrTiers(
                      sRow?.perCase ?? null,
                      categoryEffortSnapshot.perCaseBySubKey.get(subKey) ?? []
                    );
                    const baseStat = categoryEffortSnapshot.baselineBySub.get(subKey);
                    const subPerHour =
                      hours > 0 && Number.isFinite(hours)
                        ? ((itemTotalCount ?? 0) / hours).toFixed(2)
                        : null;
                    return (
                      <tr key={displayName} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                        <td className="max-w-md px-2 py-1.5 text-center font-medium sm:px-3" title={fullCategory}>
                          <span className="line-clamp-2">{displayName}</span>
                        </td>
                        <td className="px-1 py-1.5 text-center tabular-nums">
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="font-medium text-primary hover:underline tabular-nums">
                                {participantCount}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72" align="center">
                              <p className="text-xs font-semibold text-foreground mb-2">참여 인원 ({participantCount}명)</p>
                              <ul className="text-sm text-muted-foreground space-y-1 max-h-56 overflow-y-auto">
                                {participantEntriesForExactCategory(
                                  categoryEffortSnapshot.filteredLogs,
                                  members,
                                  fullCategory || ''
                                ).map(({ id, name }) => (
                                  <li key={id}>{name}</li>
                                ))}
                              </ul>
                            </PopoverContent>
                          </Popover>
                        </td>
                        <td className="px-1 py-1.5 text-center font-semibold text-primary tabular-nums whitespace-nowrap">
                          {hours.toFixed(1)}h
                        </td>
                        <td className="px-1 py-1.5 text-center tabular-nums text-muted-foreground whitespace-nowrap">
                          {subPerHour != null ? `${subPerHour}건/h` : '—'}
                        </td>
                        <td className="px-1 py-1.5 align-middle">
                          <div className="flex min-w-0 items-center justify-center gap-1.5">
                            <div className="h-1.5 w-9 shrink-0 overflow-hidden rounded-full bg-muted sm:h-2 sm:w-11">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
                            </div>
                            <span className="min-w-[2.25rem] shrink-0 text-center tabular-nums text-muted-foreground">
                              {percentage.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-1 py-1.5 text-center tabular-nums text-[#0f766e] whitespace-nowrap">
                          {baseStat?.baselinePerCase != null ? baseStat.baselinePerCase.toFixed(2) : '—'}
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <EffortIqrSignal tier={tier} />
                        </td>
                        <td className="px-1 py-1.5 text-center tabular-nums text-muted-foreground">
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline tabular-nums"
                            onClick={() => {
                              const smajor = emajor || selectedMajorForSub || '';
                              const ssub = esub ?? '-';
                              setCategoryEffortSheet({ kind: 'sub', major: smajor, sub: ssub });
                            }}
                          >
                            {itemTotalCount ?? 0}
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  )}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center justify-center h-full text-base text-muted-foreground">
                {Object.keys(stats.subCategoryStatsByMajor || {}).length > 0 
                  ? "대분류를 선택하세요" 
                  : "소분류 데이터가 없습니다"}
              </div>
            )}
          </div>
        </div>
      </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <div className="section-card flex min-h-[300px] flex-col">
              <div className="section-header">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">대분류 비중 (시간)</h3>
                </div>
              </div>
              <div className="min-h-[260px] w-full flex-1 p-2 sm:p-4">
                {majorPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <RePieChart>
                      <Pie
                        data={majorPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={64}
                        outerRadius={96}
                        paddingAngle={2}
                        isAnimationActive={false}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        onClick={(_, idx) => {
                          const row = majorPieData[idx as number];
                          if (row?.name) setSelectedMajorForSub(row.name);
                        }}
                      >
                        {majorPieData.map((_, i) => (
                          <Cell key={i} fill={pieColors[i % pieColors.length]} className="cursor-pointer outline-none" />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)} h`} />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[280px] items-center justify-center text-base text-muted-foreground">대분류 데이터가 없습니다</div>
                )}
              </div>
            </div>
            <div className="section-card flex min-h-[300px] flex-col">
              <div className="section-header">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">
                    소분류 비중
                    {selectedMajorForSub && (
                      <span className="text-muted-foreground font-normal ml-1">— {selectedMajorForSub}</span>
                    )}
                  </h3>
                </div>
              </div>
              <div className="min-h-[260px] w-full flex-1 p-2 sm:p-4">
                {subPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <RePieChart>
                      <Pie
                        data={subPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={64}
                        outerRadius={96}
                        paddingAngle={2}
                        isAnimationActive={false}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      >
                        {subPieData.map((_, i) => (
                          <Cell key={i} fill={pieColors[(i + 2) % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)} h`} />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[280px] items-center justify-center text-base text-muted-foreground">
                    {selectedMajorForSub ? '해당 대분류의 소분류 데이터가 없습니다' : '도넛에서 대분류를 선택하세요'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <Sheet
        open={categoryEffortSheet != null}
        onOpenChange={(o) => {
          if (!o) setCategoryEffortSheet(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {categoryEffortSheet && (
            <>
              <SheetHeader>
                <SheetTitle className="text-left">
                  {categoryEffortSheet.kind === 'major'
                    ? `${categoryEffortSheet.major} (대분류 전체)`
                    : `${categoryEffortSheet.major} > ${
                        categoryEffortSheet.sub === '-' ? '—' : categoryEffortSheet.sub
                      }`}
                </SheetTitle>
                <p className="text-xs text-muted-foreground text-left pt-1">
                  유닛을 선택하면 일자별 <code className="text-[11px]">WorkLog</code> 원시 행을 표시합니다.
                </p>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                {(() => {
                  const subUnits =
                    categoryEffortSheet.kind === 'major'
                      ? unitsForMajor(categoryEffortSnapshot.units, categoryEffortSheet.major)
                      : unitsForSubKey(
                          categoryEffortSnapshot.units,
                          categoryEffortSheet.major,
                          categoryEffortSheet.sub
                        );
                  const list =
                    categoryEffortSheet.kind === 'major'
                      ? categoryEffortSnapshot.perCaseByMajor.get(categoryEffortSheet.major) ?? []
                      : categoryEffortSnapshot.perCaseBySubKey.get(
                          `${categoryEffortSheet.major}\t${categoryEffortSheet.sub}`
                        ) ?? [];
                  return (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-2 py-2">업무 단위</th>
                            <th className="text-right px-2 py-2">건당(h)</th>
                            <th className="text-center px-2 py-2">상태</th>
                            <th className="text-center px-1 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {subUnits.map((u) => {
                            const pc = unitPerCase(u);
                            const ut = classifyPerCaseUpperIqrTiers(pc, list);
                            const label = u.taskCode
                              ? `${u.taskCode.slice(0, 12)}${u.taskCode.length > 12 ? '…' : ''}`
                              : '무코드';
                            const rowKey = `${u.memberId}-${u.taskCode ?? u.dateMin}`;
                            const isExpanded = categoryEffortExpandedUnitKey === rowKey;
                            return (
                              <Fragment key={rowKey}>
                                <tr className="border-t border-border/60">
                                  <td className="px-2 py-1.5 font-mono text-[11px]">{label}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">
                                    {pc != null ? pc.toFixed(2) : '—'}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <EffortIqrSignal tier={ut} />
                                  </td>
                                  <td className="px-1 py-1.5 text-center">
                                    <button
                                      type="button"
                                      className="text-primary hover:underline"
                                      onClick={() =>
                                        setCategoryEffortExpandedUnitKey((k) => (k === rowKey ? null : rowKey))
                                      }
                                    >
                                      상세
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr className="border-t border-border/40 bg-muted/15">
                                    <td colSpan={4} className="px-2 py-2 align-top">
                                      <p className="text-xs font-semibold text-[#1e293b] mb-2">일자별 로그</p>
                                      <div className="max-h-64 overflow-y-auto space-y-2">
                                        {logsForMergedUnit(categoryEffortSnapshot.filteredLogs, u).map((log) => (
                                          <div
                                            key={log.id}
                                            className="rounded-md bg-background border border-border/60 px-2 py-1.5 text-[11px]"
                                          >
                                            <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-muted-foreground">
                                              <span>
                                                {log.date}
                                                <span className="text-foreground/80 font-medium ml-1.5">
                                                  {memberNameById.get(log.memberId) ?? log.memberId}
                                                </span>
                                              </span>
                                              <span className="tabular-nums shrink-0">
                                                {log.duration}h · {log.count}건 · {log.status}
                                              </span>
                                            </div>
                                            <p className="text-foreground mt-0.5 line-clamp-2">{log.content}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      </>
      )}

      {mode === 'member' && (
      <>
      <div className="section-card">
        <div className="section-header">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">팀원별 업무 현황</h3>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.memberStats.map(({ member, hours, taskCount, totalCount: memberItemCount }) => (
            <button
              key={member.id}
              type="button"
              onClick={() => {
                if (statsViewMode === 'chart') {
                  setChartDetailMember(member);
                } else {
                  onMemberClick?.(member);
                }
              }}
              className={cn(
                'p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors text-left cursor-pointer',
                statsViewMode === 'chart' && chartDetailMember?.id === member.id && 'ring-2 ring-primary/50 bg-primary/5'
              )}
            >
              <div className="mb-2 min-w-0">
                <p className="text-base font-semibold truncate">{member.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{member.role}</p>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="p-1.5 rounded-lg bg-card min-w-0">
                  <p className="text-base font-bold text-primary">{hours.toFixed(1)}h</p>
                  <p className="text-[9px] text-muted-foreground">시간</p>
                </div>
                <div className="p-1.5 rounded-lg bg-card min-w-0">
                  <p className="text-base font-bold">{taskCount}</p>
                  <p className="text-[9px] text-muted-foreground" title="기록 행 수">작성</p>
                </div>
                <div className="p-1.5 rounded-lg bg-card min-w-0">
                  <p className="text-base font-bold">{memberItemCount ?? 0}</p>
                  <p className="text-[9px] text-muted-foreground" title="건수란 합계">업무</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Dialog
        open={statsViewMode === 'chart' && chartDetailMember != null}
        onOpenChange={(open) => {
          if (!open) setChartDetailMember(null);
        }}
      >
        <DialogContent
          key={chartDetailMember?.id ?? 'closed'}
          className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-4xl"
        >
          {chartDetailMember && (
            <>
              <DialogHeader>
                <DialogTitle>「{chartDetailMember.name}」 세부 현황</DialogTitle>
                <DialogDescription>
                  팀원별 통계 탭에서 선택한 연·월(또는 연간) 기준 도넛·세부 분석입니다.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="section-card flex flex-col min-h-[280px]">
                    <div className="section-header">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        <h3 className="text-sm font-semibold">대분류 (본인)</h3>
                      </div>
                    </div>
                    <div className="flex-1 min-h-[240px] w-full min-w-0 p-2">
                      {memberMajorPieData.length > 0 ? (
                        <div className="h-[260px] w-full min-w-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <RePieChart>
                              <Pie
                                data={memberMajorPieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={56}
                                outerRadius={88}
                                paddingAngle={2}
                                isAnimationActive={false}
                                dataKey="value"
                                nameKey="name"
                                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                onClick={(_, idx) => {
                                  const row = memberMajorPieData[idx as number];
                                  if (row?.name) setMemberDetailMajor(row.name);
                                }}
                              >
                                {memberMajorPieData.map((_, i) => (
                                  <Cell
                                    key={i}
                                    fill={pieColors[i % pieColors.length]}
                                    className="cursor-pointer outline-none"
                                  />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)} h`} />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="flex h-[260px] items-center justify-center text-base text-muted-foreground">
                          데이터 없음
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="section-card flex flex-col min-h-[280px]">
                    <div className="section-header">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-info" />
                        <h3 className="text-sm font-semibold">업무 지표 (시간)</h3>
                      </div>
                    </div>
                    <div className="flex-1 min-h-[240px] w-full min-w-0 p-2">
                      {memberWiPieData.length > 0 ? (
                        <div className="h-[260px] w-full min-w-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <RePieChart>
                              <Pie
                                data={memberWiPieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={56}
                                outerRadius={88}
                                paddingAngle={2}
                                isAnimationActive={false}
                                dataKey="value"
                                nameKey="name"
                                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                              >
                                {memberWiPieData.map((_, i) => (
                                  <Cell key={i} fill={pieColors[(i + 3) % pieColors.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)} h`} />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="flex h-[260px] items-center justify-center text-base text-muted-foreground">
                          데이터 없음
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="section-card">
                  <div className="section-header flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-semibold">소분류 (선택 대분류)</h3>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {memberMajorPieData.map((m) => (
                        <button
                          key={m.name}
                          type="button"
                          onClick={() => setMemberDetailMajor(m.name)}
                          className={cn(
                            'px-2 py-1 text-xs rounded-md border transition-colors',
                            memberDetailMajor === m.name
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted/40 border-border/60 hover:bg-muted/70'
                          )}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="min-h-[260px] w-full min-w-0 p-2">
                    {memberSubPieData.length > 0 ? (
                      <div className="h-[280px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <RePieChart>
                            <Pie
                              data={memberSubPieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={64}
                              outerRadius={96}
                              paddingAngle={2}
                              isAnimationActive={false}
                              dataKey="value"
                              nameKey="name"
                              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                            >
                              {memberSubPieData.map((_, i) => (
                                <Cell key={i} fill={pieColors[(i + 1) % pieColors.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)} h`} />
                          </RePieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="flex h-[280px] items-center justify-center text-base text-muted-foreground">
                        {memberDetailMajor ? '해당 대분류의 소분류 데이터가 없습니다' : '대분류를 선택하세요'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}

// 팀원 카드 - 수정 가능
function MemberCard({ member, onUpdate, onDelete }: { member: TeamMember; onUpdate: (id: string, updates: Partial<TeamMember>) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [employeeNo, setEmployeeNo] = useState(member.employeeNo ?? '');
  useEffect(() => {
    setName(member.name);
    setRole(member.role);
    setEmployeeNo(member.employeeNo ?? '');
  }, [member.name, member.role, member.employeeNo]);
  const handleSave = () => {
    if (name.trim() && role.trim()) {
      const emp = employeeNo.trim();
      onUpdate(member.id, {
        name: name.trim(),
        role: role.trim(),
        employeeNo: emp ? emp : null,
      });
      setEditing(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors">
      {editing ? (
        <div className="flex-1 min-w-0 mr-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-w-0 px-3 py-2 text-base rounded-lg border border-input bg-background"
            />
            <input
              type="text"
              placeholder="직책"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full min-w-0 px-3 py-2 text-base rounded-lg border border-input bg-background"
            />
            <input
              type="text"
              placeholder="사번"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              className="w-full min-w-0 px-3 py-2 text-base rounded-lg border border-input bg-background"
              autoComplete="off"
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
            {member.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-base font-medium truncate">{member.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {member.role}
              {member.employeeNo ? ` · 사번 ${member.employeeNo}` : ''}
            </p>
          </div>
        </div>
      )}
      <div className="flex gap-1 shrink-0">
        {editing ? (
          <>
            <button onClick={handleSave} className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors">
              <Check className="w-3.5 h-3.5 text-primary" />
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setName(member.name);
                setRole(member.role);
                setEmployeeNo(member.employeeNo ?? '');
              }}
              className="p-1.5 hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button onClick={() => onDelete(member.id)} className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors">
              <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TeamMembersManagementTab({
  members,
  showAddForm,
  setShowAddForm,
  newMemberName,
  setNewMemberName,
  newMemberRole,
  setNewMemberRole,
  newMemberEmployeeNo,
  setNewMemberEmployeeNo,
  pendingNewMembers,
  setPendingNewMembers,
  handleAddMember,
  onUpdateMember,
  onDeleteMember,
  onSavePendingMembers,
}: {
  members: TeamMember[];
  showAddForm: boolean;
  setShowAddForm: (v: boolean) => void;
  newMemberName: string;
  setNewMemberName: (v: string) => void;
  newMemberRole: string;
  setNewMemberRole: (v: string) => void;
  newMemberEmployeeNo: string;
  setNewMemberEmployeeNo: (v: string) => void;
  pendingNewMembers: { name: string; role: string; employeeNo?: string }[];
  setPendingNewMembers: (
    v:
      | { name: string; role: string; employeeNo?: string }[]
      | ((p: { name: string; role: string; employeeNo?: string }[]) => { name: string; role: string; employeeNo?: string }[])
  ) => void;
  handleAddMember: () => void;
  onUpdateMember: (id: string, updates: Partial<TeamMember>) => void;
  onDeleteMember: (id: string) => void;
  onSavePendingMembers: () => Promise<void>;
}) {
  const [savingPending, setSavingPending] = useState(false);

  return (
    <div className="space-y-6">
      <p className="text-base text-muted-foreground">
        이 팀의 팀원을 추가·편집·삭제합니다. 샘플 데이터·기록 일괄 삭제는 마스터 관리 메뉴에서 수행할 수 있습니다.
      </p>

      {pendingNewMembers.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              setSavingPending(true);
              try {
                await onSavePendingMembers();
              } finally {
                setSavingPending(false);
              }
            }}
            disabled={savingPending}
            className="worklog-btn-primary disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {savingPending ? '저장 중…' : '추가한 팀원 저장'}
          </button>
        </div>
      )}

      <div className="worklog-day-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
            <Users className="w-5 h-5 text-primary" />
            팀원 목록
          </h3>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-2 hover:bg-secondary rounded-xl transition-colors"
            title="팀원 추가"
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {showAddForm && (
          <div className="mb-4 p-4 bg-secondary/50 rounded-xl space-y-2 border border-border/60">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="이름"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                className="w-full min-w-0 px-3 py-2 text-base rounded-lg border border-input bg-background"
              />
              <input
                type="text"
                placeholder="직책"
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
                className="w-full min-w-0 px-3 py-2 text-base rounded-lg border border-input bg-background"
              />
              <input
                type="text"
                placeholder="사번 (선택)"
                value={newMemberEmployeeNo}
                onChange={(e) => setNewMemberEmployeeNo(e.target.value)}
                className="w-full min-w-0 px-3 py-2 text-base rounded-lg border border-input bg-background"
                autoComplete="off"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="flex-1 py-2 text-base rounded-lg bg-background hover:bg-muted transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleAddMember}
                className="flex-1 py-2 text-base rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                목록에 추가
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-[min(420px,50vh)] overflow-y-auto pr-1">
          {members.map((member) => (
            <MemberCard key={member.id} member={member} onUpdate={onUpdateMember} onDelete={onDeleteMember} />
          ))}
          {pendingNewMembers.map((m, idx) => (
            <div
              key={`pending-${idx}`}
              className="flex items-center justify-between p-2.5 bg-primary/10 rounded-lg border border-primary/30"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                  {m.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-base font-medium truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.role}
                    {m.employeeNo ? ` · 사번 ${m.employeeNo}` : ''}{' '}
                    <span className="text-primary">(저장 대기)</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingNewMembers((prev) => prev.filter((_, i) => i !== idx))}
                className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <X className="w-3.5 h-3.5 text-destructive/70" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoriesManagementTab({
  categoriesTree,
  editingCategories,
  setEditingCategories,
  categoryTreeList,
  setCategoryTreeList,
  newMajorName,
  setNewMajorName,
  newSubName,
  setNewSubName,
  newSubByParent,
  setNewSubByParent,
  handleAddMajorCategory,
  handleAddSubCategory,
  handleRemoveCategory,
  handleRenameCategory,
  handleSaveCategories,
  onLoadQACategories,
}: {
  categoriesTree: Category[];
  editingCategories: boolean;
  setEditingCategories: (v: boolean) => void;
  categoryTreeList: Category[];
  setCategoryTreeList: (v: Category[]) => void;
  newMajorName: string;
  setNewMajorName: (v: string) => void;
  newSubName: string;
  setNewSubName: (v: string) => void;
  newSubByParent: Record<number, string>;
  setNewSubByParent: (v: Record<number, string> | ((p: Record<number, string>) => Record<number, string>)) => void;
  handleAddMajorCategory: () => void;
  handleAddSubCategory: (parentId: number) => void;
  handleRemoveCategory: (id: number) => void;
  handleRenameCategory: (id: number, name: string) => void;
  handleSaveCategories: () => Promise<void>;
  onLoadQACategories?: () => Promise<void>;
}) {
  const [loadingQA, setLoadingQA] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [selectedMajorId, setSelectedMajorId] = useState<number | null>(null);
  const treeSource = editingCategories ? categoryTreeList : categoriesTree || [];
  const selectedMajorForView = treeSource.find((c: Category) => !c.parentId && c.id === selectedMajorId) ?? null;

  return (
    <div className="space-y-6">
      <div className="worklog-day-card flex flex-col p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1e293b]">
            <Layers className="w-5 h-5 text-primary" />
            분류 트리
          </h3>
          {editingCategories ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingCategories(false)}
                className="px-3 py-1.5 text-base rounded-lg border border-border bg-background hover:bg-muted transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  setSavingCategories(true);
                  try {
                    await handleSaveCategories();
                  } finally {
                    setSavingCategories(false);
                  }
                }}
                disabled={savingCategories}
                className="worklog-btn-primary py-1.5 text-base disabled:opacity-50"
              >
                {savingCategories ? '저장 중…' : '저장'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingCategories(true);
                setCategoryTreeList(categoriesTree || []);
              }}
              className="worklog-btn-secondary py-1.5 text-base"
            >
              <Edit2 className="w-4 h-4" />
              편집
            </button>
          )}
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr] gap-4 min-h-[240px]">
          <div className="flex flex-col gap-2 min-h-0">
            {editingCategories && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="대분류명"
                  value={newMajorName}
                  onChange={(e) => setNewMajorName(clampCategoryName(e.target.value))}
                  className="flex-1 px-3 py-2 text-base rounded-lg border border-input bg-background"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMajorCategory()}
                />
                <button
                  type="button"
                  onClick={handleAddMajorCategory}
                  className="px-3 py-2 text-base rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
                >
                  추가
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px] pr-1">
              {(editingCategories ? categoryTreeList : categoriesTree || [])
                .filter((c: Category) => !c.parentId)
                .sort((a: Category, b: Category) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                .map((major: Category) => (
                  <div
                    key={major.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
                      selectedMajorId === major.id
                        ? 'bg-primary/15 ring-1 ring-primary/30'
                        : 'bg-secondary/20 hover:bg-secondary/40'
                    )}
                    onClick={() => setSelectedMajorId(major.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedMajorId(major.id)}
                  >
                    {editingCategories ? (
                      <input
                        type="text"
                        value={major.name}
                        onChange={(e) => handleRenameCategory(major.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="text-base font-medium flex-1 min-w-0 px-2 py-1 rounded-md border border-input bg-background"
                        aria-label="대분류 이름"
                      />
                    ) : (
                      <span className="text-base font-medium truncate flex-1 min-w-0">{major.name}</span>
                    )}
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-semibold">
                      {(editingCategories ? categoryTreeList : categoriesTree || []).filter(
                        (c: Category) => c.parentId === major.id
                      ).length}
                    </span>
                    {editingCategories && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCategory(major.id);
                        }}
                        className="p-1 hover:bg-destructive/10 rounded transition-colors shrink-0"
                      >
                        <X className="w-3.5 h-3.5 text-destructive/70" />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 min-h-0 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-4">
            {selectedMajorForView ? (
              <>
                {editingCategories && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={`${selectedMajorForView.name} 소분류`}
                      value={newSubByParent[selectedMajorForView.id] ?? ''}
                      onChange={(e) =>
                        setNewSubByParent((prev) => ({
                          ...prev,
                          [selectedMajorForView.id]: clampCategoryName(e.target.value),
                        }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && handleAddSubCategory(selectedMajorForView.id)}
                      className="flex-1 px-3 py-2 text-base rounded-lg border border-input bg-background"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddSubCategory(selectedMajorForView.id)}
                      disabled={!newSubByParent[selectedMajorForView.id]?.trim()}
                      className="px-3 py-2 text-base rounded-lg bg-primary/80 text-primary-foreground hover:bg-primary transition-colors disabled:opacity-50 shrink-0"
                    >
                      추가
                    </button>
                  </div>
                )}
                <div className="text-base font-semibold text-muted-foreground mb-1">소분류 — {selectedMajorForView.name}</div>
                <div className="flex-1 overflow-y-auto space-y-1 min-h-0 max-h-[min(360px,45vh)]">
                  {(editingCategories ? categoryTreeList : categoriesTree || [])
                    .filter((c: Category) => c.parentId === selectedMajorForView.id)
                    .sort((a: Category, b: Category) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                    .map((sub: Category) => (
                      <div key={sub.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-secondary/30 rounded-lg">
                        {editingCategories ? (
                          <input
                            type="text"
                            value={sub.name}
                            onChange={(e) => handleRenameCategory(sub.id, e.target.value)}
                            className="text-base font-medium flex-1 min-w-0 px-2 py-1 rounded-md border border-input bg-background"
                            aria-label="소분류 이름"
                          />
                        ) : (
                          <span className="text-base font-medium flex-1 min-w-0">{sub.name}</span>
                        )}
                        {editingCategories && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCategory(sub.id)}
                            className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors shrink-0"
                          >
                            <X className="w-3.5 h-3.5 text-destructive/70" />
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <p className="text-base text-muted-foreground py-8 text-center md:text-left">왼쪽에서 대분류를 선택하세요.</p>
            )}
          </div>
        </div>

        {onLoadQACategories && (
          <div className="mt-6 pt-6 border-t border-border">
            <button
              type="button"
              onClick={async () => {
                setLoadingQA(true);
                try {
                  await onLoadQACategories();
                  toast.success('QA 업무분류가 적용되었습니다.');
                } catch (e) {
                  console.error('QA 업무분류 적용 실패:', e);
                  toast.error('QA 업무분류 적용에 실패했습니다.');
                } finally {
                  setLoadingQA(false);
                }
              }}
              disabled={loadingQA}
              className="w-full px-4 py-3 text-base font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loadingQA ? '불러오는 중…' : 'QA 업무분류 불러오기'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
