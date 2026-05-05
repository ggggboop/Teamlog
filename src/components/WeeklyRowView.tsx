import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect, type MutableRefObject } from 'react';
import { Plus, Save, CircleHelp } from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  addDays,
  startOfMonth,
  endOfMonth,
  eachWeekOfInterval,
  isSameWeek,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { TeamMember, WorkLog, WorkCategory, WorkStatus, WorkIndicatorType, LEAVE_TYPE_OPTIONS } from '@/types/workLog';
import { isDateBeforeWorkRecordStart } from '@/constants/workRecordPolicy';
import { computeDailyWorkHoursLimit } from '@/utils/dailyWorkHours';
import { InlineLogRow, InlineLogRowHandle, InlineLogRowData, InvalidFieldKey } from './InlineLogRow';
import { InProgressLogsDialog } from './InProgressLogsDialog';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { formatFriendlyDataError } from '@/utils/ipcFriendlyError';
import { addDurations, finalizeDurationSum } from '@/utils/workLogNumeric';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface WeeklyRowViewProps {
  member: TeamMember;
  logs: WorkLog[];
  categories: string[];
  categoriesTree?: import('@/types/workLog').Category[];
  currentDate: Date;
  onSaveAll: (
    newLogs: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>[],
    updatedLogs: { id: string; updates: Partial<WorkLog> }[],
    deletedLogIds: string[],
    requesterMemberId: string
  ) => void;
  getDailyExtensionHours: (memberId: string, date: string) => Promise<number>;
  setDailyExtensionHours: (memberId: string, date: string, hours: number) => Promise<void>;
  setDailyLeaveType: (memberId: string, date: string, leaveType: string | null) => Promise<void>;
  dailyLeaveTypes: Record<string, string | null>;
  onDailyLeaveChange: (dateKey: string, value: string | null) => void;
  leaveTypesLoaded: boolean;
  dailyMetaDirtyRef: MutableRefObject<boolean>;
  /** 이 날짜(yyyy-MM-dd) 미만은 업무 행 편집 불가(null이면 제한 없음) */
  workRecordStartDate: string | null;
  /** true면 다른 팀원 열람 모드: 입력·저장·일일 연차/연장 변경 불가 */
  readOnly?: boolean;
  /** 즐겨찾기가 있으면 대·소분류 선택이 이 목록으로 제한됨 */
  favoriteCategoryKeys?: string[];
}

const DEFAULT_EMPTY_ROWS = 1;

/** 주의 '대표 월'은 목요일 기준(ISO 관례)으로 두고, 그 달의 몇 번째 월요일~주인지 표시 */
function yearMonthWeekLabel(weekStartMonday: Date): string {
  const thursday = addDays(weekStartMonday, 3);
  const y = thursday.getFullYear();
  const m = thursday.getMonth();
  const monthStart = startOfMonth(thursday);
  const monthEnd = endOfMonth(thursday);
  const weeksInMonth = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });
  const idx = weeksInMonth.findIndex(w => isSameWeek(weekStartMonday, w, { weekStartsOn: 1 }));
  const weekNum = idx >= 0 ? idx + 1 : 1;
  return `${y}년 ${m + 1}월 ${weekNum}주차`;
}

export function WeeklyRowView({
  member,
  logs,
  categories,
  categoriesTree = [],
  currentDate,
  onSaveAll,
  getDailyExtensionHours,
  setDailyExtensionHours,
  setDailyLeaveType,
  dailyLeaveTypes,
  onDailyLeaveChange,
  leaveTypesLoaded,
  dailyMetaDirtyRef,
  workRecordStartDate,
  readOnly = false,
  favoriteCategoryKeys = [],
}: WeeklyRowViewProps) {
  const [extraRows, setExtraRows] = useState<Record<string, number>>({});
  const [showInProgressDialog, setShowInProgressDialog] = useState(false);
  const continueTargetDateRef = useRef<string | null>(null);
  const [stagedInProgressLoad, setStagedInProgressLoad] = useState<{ dateKey: string; log: WorkLog } | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [inProgressHelpOpen, setInProgressHelpOpen] = useState(false);
  const [saveCounter, setSaveCounter] = useState(0); // 저장 시 빈 행 key 갱신용
  const [validationErrors, setValidationErrors] = useState<Record<string, InvalidFieldKey[]>>({});
  const [dailyExtensions, setDailyExtensions] = useState<Record<string, number>>({});
  const [, setEditTrigger] = useState(0); // 미분류 시간 실시간 재계산용
  /** 연장 메타 로드 완료 — flush 가능 여부와 함께 leaveTypesLoaded 사용 */
  const weeklyMetaLoadedRef = useRef(false);

  // Store refs for all rows
  const rowRefs = useRef<Map<string, InlineLogRowHandle>>(new Map());

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const weekTitleLabel = useMemo(() => yearMonthWeekLabel(weekStart), [weekStart]);

  const memberLogs = useMemo(() => {
    return logs.filter(l => l.memberId === member.id && !pendingDeletes.includes(l.id));
  }, [logs, member.id, pendingDeletes]);

  /** 같은 taskCode 묶음의 최초 기록일 — 저장 후 log 동기화 시 시작일이 행의 date로 덮이지 않게 함 */
  const taskCodeEarliestDateByCode = useMemo(() => {
    const rec: Record<string, string> = {};
    for (const l of memberLogs) {
      if (!l.taskCode) continue;
      const cur = rec[l.taskCode];
      if (cur == null || l.date < cur) rec[l.taskCode] = l.date;
    }
    return rec;
  }, [memberLogs]);

  const logsByDate = useMemo(() => {
    const map = new Map<string, WorkLog[]>();
    memberLogs.forEach(log => {
      if (!map.has(log.date)) map.set(log.date, []);
      map.get(log.date)!.push(log);
    });
    return map;
  }, [memberLogs]);

  const handleAddRow = (dateKey: string) => {
    if (readOnly) {
      toast({
        title: '열람 전용',
        description: '다른 팀원 기록은 볼 수만 있습니다. 본인을 선택하면 작성할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    if (isDateBeforeWorkRecordStart(dateKey, workRecordStartDate)) {
      toast({
        title: '업무 기록 불가',
        description: workRecordStartDate
          ? `업무 기록은 ${workRecordStartDate}부터 작성할 수 있습니다. 연차·반차는 아래에서 설정할 수 있습니다.`
          : undefined,
        variant: 'destructive',
      });
      return;
    }
    setExtraRows(prev => ({ ...prev, [dateKey]: (prev[dateKey] || 0) + 1 }));
  };

  const handleDelete = (id: string) => {
    if (readOnly) return;
    setPendingDeletes(prev => [...prev, id]);
  };

  const handleDeleteEmptyRow = (dateKey: string, rowIndex: number) => {
    if (readOnly) return;
    // Remove the specific extra row for this date
    setExtraRows(prev => {
      const current = prev[dateKey] || 0;
      if (current > 0) {
        return { ...prev, [dateKey]: current - 1 };
      }
      return prev;
    });
  };

  /** 해당 날짜에 빈 행을 하나 늘리고, 선택한 진행중 업무를 마지막 빈 행에 채움 (DB 원본 유지) */
  const handleContinueInProgressClick = (dateKey: string) => {
    if (readOnly) {
      toast({
        title: '열람 전용',
        description: '다른 팀원 기록은 볼 수만 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    if (isDateBeforeWorkRecordStart(dateKey, workRecordStartDate)) {
      toast({
        title: '업무 기록 불가',
        description: workRecordStartDate
          ? `이 날짜에는 진행중 업무를 불러올 수 없습니다. (${workRecordStartDate}부터 기록 가능)`
          : undefined,
        variant: 'destructive',
      });
      return;
    }
    continueTargetDateRef.current = dateKey;
    setShowInProgressDialog(true);
  };

  const handleInProgressPick = useCallback((log: WorkLog) => {
    const dk = continueTargetDateRef.current;
    if (!dk) return;
    if (isDateBeforeWorkRecordStart(dk, workRecordStartDate)) {
      toast({
        title: '업무 기록 불가',
        description: workRecordStartDate
          ? `대상 날짜가 ${workRecordStartDate} 이전이면 저장할 수 없습니다.`
          : undefined,
        variant: 'destructive',
      });
      continueTargetDateRef.current = null;
      return;
    }
    continueTargetDateRef.current = null;
    setExtraRows(prev => ({ ...prev, [dk]: (prev[dk] || 0) + 1 }));
    setStagedInProgressLoad({ dateKey: dk, log });
  }, [workRecordStartDate]);

  const applyStagedInProgressToRow = useCallback(() => {
    if (!stagedInProgressLoad) return false;
    const { dateKey, log } = stagedInProgressLoad;
    const prefix = `${dateKey}-row-new-`;
    let bestKey: string | null = null;
    let bestIdx = -1;
    rowRefs.current.forEach((_, key) => {
      if (!key.startsWith(prefix)) return;
      const match = key.match(/-row-new-\d+-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx > bestIdx) {
          bestIdx = idx;
          bestKey = key;
        }
      }
    });
    const handle = bestKey ? rowRefs.current.get(bestKey) : null;
    if (!handle) return false;
    const tc = log.taskCode ?? crypto.randomUUID();
    let startDateStr = log.date;
    if (log.taskCode) {
      const related = memberLogs.filter((l) => l.taskCode === log.taskCode);
      if (related.length > 0) {
        startDateStr = related.reduce((min, l) => (l.date < min ? l.date : min), related[0]!.date);
      }
    }
    handle.setData({
      category: log.category,
      content: log.content,
      issues: log.issues || '',
      count: log.count,
      duration: log.duration,
      status: '진행중',
      workIndicator: log.workIndicator,
      startDate: startDateStr,
      taskCode: tc,
    });
    setStagedInProgressLoad(null);
    return true;
  }, [stagedInProgressLoad, memberLogs]);

  useLayoutEffect(() => {
    if (!stagedInProgressLoad) return;
    if (applyStagedInProgressToRow()) return;
    const id = requestAnimationFrame(() => {
      applyStagedInProgressToRow();
    });
    return () => cancelAnimationFrame(id);
  }, [stagedInProgressLoad, extraRows, saveCounter, applyStagedInProgressToRow]);

  const handleRowDataChange = useCallback(() => {
    setEditTrigger(prev => prev + 1);
  }, []);

  const flushDailyMetaForWeek = useCallback(async () => {
    for (const day of weekDays) {
      const dateKey = format(day, 'yyyy-MM-dd');
      const leave = dailyLeaveTypes[dateKey] ?? null;
      const ext = dailyExtensions[dateKey] ?? 0;
      await setDailyLeaveType(member.id, dateKey, leave);
      await setDailyExtensionHours(member.id, dateKey, ext);
    }
  }, [
    weekDays,
    member.id,
    dailyLeaveTypes,
    dailyExtensions,
    setDailyLeaveType,
    setDailyExtensionHours,
  ]);

  const handleSave = useCallback(async () => {
    if (readOnly) {
      toast({
        title: '열람 전용',
        description: '다른 팀원 기록은 저장할 수 없습니다.',
        variant: 'destructive',
      });
      return;
    }
    const newLogs: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>[] = [];
    const updatedLogs: { id: string; updates: Partial<WorkLog> }[] = [];
    const processedNewRowKeys: string[] = [];
    const errors: Record<string, InvalidFieldKey[]> = {};

    rowRefs.current.forEach((ref, key) => {
      const data = ref.getData();
      if (data.isEmpty) return;

      // key 형식: "yyyy-MM-dd-row-{id}" 또는 "yyyy-MM-dd-row-new-{counter}-{idx}"
      const rowPart = key.indexOf('-row-');
      const dateKey = rowPart >= 0 ? key.slice(0, rowPart) : key;

      // 필수 필드 검증: 미작성 필드 수집
      const invalidFields: InvalidFieldKey[] = [];
      if (!data.category) invalidFields.push('category');
      if (!data.content?.trim()) invalidFields.push('content');
      if (data.duration === '' || data.duration === undefined) invalidFields.push('duration');
      if (data.count === '' || data.count === undefined) invalidFields.push('count');
      if (!data.status) invalidFields.push('status');
      if (!data.workIndicator) invalidFields.push('workIndicator');

      if (invalidFields.length > 0) {
        errors[key] = invalidFields;
        return;
      }

      if (data.isNew) {
        processedNewRowKeys.push(key);
        const taskCode = data.taskCode ?? crypto.randomUUID();
        newLogs.push({
          memberId: member.id,
          date: dateKey,
          category: data.category as WorkCategory,
          content: data.content,
          issues: data.issues || undefined,
          duration: data.duration as number,
          count: data.count as number,
          status: data.status as WorkStatus,
          workIndicator: data.workIndicator as WorkIndicatorType,
          taskCode,
        });
      } else if (data.id) {
        // Existing log - check if changed
        const originalLog = logs.find(l => l.id === data.id);
        if (originalLog) {
          const numDuration = data.duration === '' ? 0 : Number(data.duration);
          const numCount = data.count === '' ? 0 : Number(data.count);
          const hasChanges =
            dateKey !== originalLog.date ||
            originalLog.category !== data.category ||
            originalLog.content !== data.content ||
            (originalLog.issues ?? '') !== (data.issues ?? '') ||
            originalLog.duration !== numDuration ||
            originalLog.count !== numCount ||
            originalLog.status !== data.status ||
            originalLog.workIndicator !== data.workIndicator ||
            (originalLog.taskCode ?? '') !== (data.taskCode ?? '');

          if (hasChanges) {
            const taskCode = data.taskCode ?? originalLog.taskCode ?? crypto.randomUUID();
            const updates: Partial<WorkLog> = {
              category: data.category as WorkCategory,
              content: data.content,
              issues: data.issues || undefined,
              duration: numDuration,
              count: numCount,
              status: data.status as WorkStatus,
              workIndicator: data.workIndicator as WorkIndicatorType,
              taskCode,
            };
            if (dateKey !== originalLog.date) {
              updates.date = dateKey;
            }
            updatedLogs.push({ id: data.id, updates });
          }
        }
      }
    });

    // 미작성 필드가 있으면 붉은 테두리 표시 후 저장 중단
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      toast({
        title: "저장 실패",
        description: "작성되지 않은 필드가 있습니다. 붉은 테두리로 표시된 항목을 확인해 주세요.",
        variant: "destructive",
      });
      return;
    }

    const hasLogWork =
      newLogs.length > 0 || updatedLogs.length > 0 || pendingDeletes.length > 0;
    const hasDailyMetaWork =
      dailyMetaDirtyRef.current && weeklyMetaLoadedRef.current && leaveTypesLoaded;

    if (!hasLogWork && !hasDailyMetaWork) {
      toast({
        title: "변경사항 없음",
        description: "저장할 변경사항이 없습니다.",
      });
      return;
    }

    setValidationErrors({}); // 검증 성공 시 에러 초기화

    // 삭제 예정인 로그는 수정 목록에서 제외 (이중 처리 방지)
    const pendingSet = new Set(pendingDeletes);
    const filteredUpdatedLogs = updatedLogs.filter(({ id }) => !pendingSet.has(id));

    // Clear refs for processed new rows to prevent duplication
    processedNewRowKeys.forEach(key => {
      rowRefs.current.delete(key);
    });

    setSaving(true);
    try {
      if (hasDailyMetaWork) {
        await flushDailyMetaForWeek();
        dailyMetaDirtyRef.current = false;
      }
      if (hasLogWork) {
        await onSaveAll(newLogs, filteredUpdatedLogs, pendingDeletes, member.id);
        setPendingDeletes([]);
        setExtraRows({});
        setSaveCounter(prev => prev + 1); // 빈 행 key 갱신으로 상태 초기화
      }
      const parts: string[] = [];
      if (hasDailyMetaWork) parts.push('일일 근무(연차·연장) 반영');
      if (hasLogWork) {
        parts.push(
          `${newLogs.length}개 추가, ${filteredUpdatedLogs.length}개 수정, ${pendingDeletes.length}개 삭제`
        );
      }
      toast({
        title: "저장 완료",
        description: parts.join(' · '),
      });
    } catch (err) {
      console.error('[WeeklyRowView] 저장 실패:', err);
      toast({
        title: "저장 실패",
        description: formatFriendlyDataError(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [
    member.id,
    logs,
    pendingDeletes,
    onSaveAll,
    flushDailyMetaForWeek,
    workRecordStartDate,
    readOnly,
    leaveTypesLoaded,
  ]);

  const setRowRef = useCallback((key: string, ref: InlineLogRowHandle | null) => {
    if (ref) {
      rowRefs.current.set(key, ref);
    } else {
      rowRefs.current.delete(key);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const extMap: Record<string, number> = {};
      for (const day of weekDays) {
        const dateKey = format(day, 'yyyy-MM-dd');
        const ext = await getDailyExtensionHours(member.id, dateKey);
        if (!cancelled) extMap[dateKey] = ext;
      }
      if (!cancelled) {
        setDailyExtensions(extMap);
        dailyMetaDirtyRef.current = false;
        weeklyMetaLoadedRef.current = true;
      }
    };
    load();
    return () => {
      cancelled = true;
      weeklyMetaLoadedRef.current = false;
    };
  }, [member.id, format(weekStart, 'yyyy-MM-dd'), getDailyExtensionHours, dailyMetaDirtyRef]);

  const handleDailyExtensionChange = useCallback((dateKey: string, value: number) => {
    if (readOnly) return;
    const v = Math.max(0, Number(value) || 0);
    setDailyExtensions(prev => ({ ...prev, [dateKey]: v }));
    dailyMetaDirtyRef.current = true;
    void setDailyExtensionHours(member.id, dateKey, v);
  }, [member.id, setDailyExtensionHours, readOnly]);

  const handleDailyLeaveChange = useCallback(
    (dateKey: string, value: string | null) => {
      if (readOnly) return;
      onDailyLeaveChange(dateKey, value);
    },
    [readOnly, onDailyLeaveChange]
  );

  return (
    <div className="h-full flex flex-col min-h-0 bg-transparent">
      <header className="worklog-topbar">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-[#1e293b] tracking-tight">{weekTitleLabel}</h2>
          {readOnly && (
            <p className="mt-1 text-xs text-amber-800/90">
              다른 팀원 기록 — <strong>열람만</strong> 가능합니다. 수정·작성은 본인을 선택한 뒤에 할 수 있습니다.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setInProgressHelpOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-medium text-[#64748b] shadow-sm transition-colors hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#02a1c0]"
            title="진행 중인 업무 이어쓰기 · 통계·내 기록 반영 방식 안내"
          >
            <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
            진행중 안내
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || readOnly}
            className={cn('worklog-btn-primary !text-sm', readOnly && 'opacity-45 pointer-events-none')}
          >
            <Save className="w-4 h-4" />
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </header>

      <Dialog open={inProgressHelpOpen} onOpenChange={setInProgressHelpOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-left text-lg font-semibold leading-snug text-[#1e293b]">
              💡 진행 중인 업무 이어쓰기 안내
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5 text-sm text-[#334155] leading-relaxed">
            <p>
              이전에 등록한 &apos;진행 중&apos; 업무를 오늘 날짜로 가져와 이어서 기록할 수 있습니다.{' '}
              <strong className="font-medium text-[#1e293b]">「진행 중 업무 추가」</strong>를 클릭하면 기존 기록은 보존되면서, 오늘 날짜로 새로운 기록 행이 생성됩니다.
            </p>
            <p>
              <strong className="text-[#0f172a]">연속성 관리:</strong>{' '}
              불러온 업무는 하나의 단위(<span className="whitespace-nowrap">Task Code</span>)로 연결되어, 여러 날에 걸친 총 소요 시간이 자동으로 합산됩니다.
            </p>
            <p className="rounded-lg border border-[#02a1c0]/20 bg-[#02a1c0]/[0.06] px-3 py-2.5">
              <strong className="text-[#0284a3]">기록 반영:</strong>{' '}
              통계나 내 기록 화면에서는 하나의 업무로 묶여 표시되며, 상세 내용과 분류는 가장 최근에 수정된 기록을 기준으로 업데이트됩니다.
            </p>
            <p className="text-xs leading-relaxed text-[#64748b]">
              <strong className="font-medium text-[#475569]">참고:</strong>{' '}
              업무 성격이 완전히 달라졌다면 불러오기 대신 &apos;새 업무 등록&apos;을 권장합니다.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <InProgressLogsDialog
        open={showInProgressDialog}
        onOpenChange={(open) => {
          setShowInProgressDialog(open);
          if (!open) continueTargetDateRef.current = null;
        }}
        logs={logs.filter(l => l.memberId === member.id)}
        onLoadLog={handleInProgressPick}
        defaultYear={currentDate.getFullYear()}
        defaultMonth={currentDate.getMonth() + 1}
      />

      <div className="worklog-content-scroll space-y-6">
      {weekDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayLogs = logsByDate.get(dateKey) || [];
          const isToday = isSameDay(day, new Date());
          const dayOfWeek = day.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const isWorkDateLocked = isDateBeforeWorkRecordStart(dateKey, workRecordStartDate);
          const rowInteractionLocked = isWorkDateLocked || readOnly;
          const defaultRows = isWeekend ? 0 : rowInteractionLocked ? 0 : DEFAULT_EMPTY_ROWS;
          const emptyRowsNeeded = Math.max(defaultRows - dayLogs.length, 0) + (extraRows[dateKey] || 0);
          
          // 당일 소요 시간 합계: 저장된 로그 + 현재 편집 중인 행(ref)에서 실시간 반영
          const totalFromRefs = (() => {
            let sum = 0;
            rowRefs.current.forEach((ref, k) => {
              if (!k.startsWith(`${dateKey}-row-`)) return;
              const d = ref.getData();
              if (d.isEmpty || d.duration === '' || d.duration === undefined) return;
              sum = addDurations(sum, d.duration);
            });
            return sum;
          })();
          const totalDuration =
            totalFromRefs > 0
              ? finalizeDurationSum(totalFromRefs)
              : dayLogs.reduce((sum, log) => addDurations(sum, log.duration), 0);

          return (
            <section
              key={dateKey}
              className={cn(
                'worklog-day-card transition-all duration-300 animate-fade-in',
                // 오늘 칸 외곽 테두리·글로우만 #5bc4d8 (브랜드 RGB 2/161/192보다 연한 동일 계열)
                isToday && 'ring-1 ring-[#5bc4d8]/32 shadow-[0_0_22px_-6px_rgba(91,196,216,0.2)]',
                isWeekend && 'opacity-95'
              )}
            >
              <div
                className={cn(
                  'worklog-day-header',
                  isToday &&
                    'border-b-[#5bc4d8]/18 bg-gradient-to-r from-[rgba(91,196,216,0.06)] to-transparent'
                )}
              >
                <h2
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium',
                    isToday ? 'text-[#02a1c0]' : 'text-[#1e293b]'
                  )}
                >
                  <span className={cn(isToday && 'font-semibold')}>{format(day, 'EEEE', { locale: ko })}</span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-medium',
                      isToday
                        ? 'border-[#5bc4d8]/38 bg-[rgba(91,196,216,0.08)] font-semibold text-[#02a1c0] shadow-[inset_0_0_0_1px_rgba(91,196,216,0.12)]'
                        : 'border-black/[0.06] bg-[#f8fafc] text-[#64748b]'
                    )}
                  >
                    {format(day, 'M월 d일', { locale: ko })}
                  </span>
                </h2>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => handleAddRow(dateKey)}
                    disabled={rowInteractionLocked}
                    className="worklog-btn-secondary py-1.5 px-3 !text-sm inline-flex items-center gap-1.5 disabled:opacity-45 disabled:pointer-events-none"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    새 업무 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => handleContinueInProgressClick(dateKey)}
                    disabled={rowInteractionLocked}
                    className="worklog-btn-secondary py-1.5 px-3 !text-sm inline-flex items-center gap-1.5 disabled:opacity-45 disabled:pointer-events-none"
                    title="다른 날짜에 기록된 진행중 업무를 이 날짜에 새 행으로 불러옵니다"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    진행중 업무 추가
                  </button>
                </div>
              </div>

              {isWorkDateLocked && workRecordStartDate && !readOnly && (
                <p className="mx-4 mb-1 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs text-amber-900">
                  이 날짜는 관리자 설정에 따라 <strong>업무 기록만</strong> 제한됩니다. 아래 <strong>연차·연장</strong>은
                  저장할 수 있습니다. (기록 가능: {workRecordStartDate}부터)
                </p>
              )}

              <div className="grid grid-cols-[28px_44px_192px_216px_minmax(0,4fr)_50px_82px_132px_minmax(4.75rem,max-content)_28px] gap-2 worklog-table-head normal-case leading-tight">
                <div className="text-center">#</div>
                <div className="text-center">시작일</div>
                <div className="truncate" title="대분류">
                  대분류
                </div>
                <div className="truncate" title="소분류">
                  소분류
                </div>
                <div className="min-w-0 truncate" title="업무내용(넓은 칸) · 특이사항은 아래 줄에 동일 폭으로 추가">
                  업무내용
                </div>
                <div className="text-center whitespace-nowrap">건수</div>
                <div className="text-center whitespace-nowrap">총 소요</div>
                <div className="text-center whitespace-nowrap">업무지표</div>
                <div className="text-center whitespace-nowrap">현황</div>
                <div />
              </div>

              <div className="px-2 py-1.5 space-y-0.5">
                {dayLogs.map((log, idx) => {
                  const rowKey = `${dateKey}-row-${log.id}`;
                  return (
                    <InlineLogRow
                      key={log.id}
                      ref={(ref) => setRowRef(rowKey, ref)}
                      log={log}
                      memberId={member.id}
                      date={dateKey}
                      rowNumber={idx + 1}
                      categories={categories}
                      categoriesTree={categoriesTree}
                      favoriteCategoryKeys={favoriteCategoryKeys}
                      taskCodeEarliestDateByCode={taskCodeEarliestDateByCode}
                      onDelete={handleDelete}
                      onDataChange={handleRowDataChange}
                      invalidFields={validationErrors[rowKey] ?? []}
                      workRecordLocked={rowInteractionLocked}
                    />
                  );
                })}
                {Array.from({ length: emptyRowsNeeded }).map((_, idx) => {
                  const rowKey = `${dateKey}-row-new-${saveCounter}-${idx}`;
                  return (
                    <InlineLogRow
                      key={rowKey}
                      ref={(ref) => setRowRef(rowKey, ref)}
                      memberId={member.id}
                      date={dateKey}
                      rowNumber={dayLogs.length + idx + 1}
                      categories={categories}
                      categoriesTree={categoriesTree}
                      favoriteCategoryKeys={favoriteCategoryKeys}
                      taskCodeEarliestDateByCode={taskCodeEarliestDateByCode}
                      onDelete={handleDelete}
                      onDeleteEmptyRow={() => handleDeleteEmptyRow(dateKey, idx)}
                      onDataChange={handleRowDataChange}
                      isNew
                      defaultStartDate={dateKey}
                      invalidFields={validationErrors[rowKey] ?? []}
                      workRecordLocked={rowInteractionLocked}
                    />
                  );
                })}
              </div>

              <div
                className={cn(
                  'mt-2 px-6 py-4',
                  isToday
                    ? 'border-t border-[#5bc4d8]/22 bg-[rgba(2,161,192,0.04)]'
                    : 'border-t border-black/[0.06] bg-[#f8fafc]/80'
                )}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#64748b]">연차</span>
                    <select
                      value={dailyLeaveTypes[dateKey] ?? ''}
                      onChange={(e) => handleDailyLeaveChange(dateKey, e.target.value || null)}
                      disabled={readOnly}
                      className={cn(
                        'text-sm text-[#1e293b] bg-background border border-[#e2e8f0] rounded-lg px-2 py-1 min-w-[100px]',
                        readOnly && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      <option value="">없음</option>
                      {LEAVE_TYPE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#64748b] whitespace-nowrap">일 업무시간</span>
                    <span className="text-sm font-semibold tabular-nums text-[#02a1c0] min-w-[3rem] text-right">
                      {computeDailyWorkHoursLimit(
                        dailyLeaveTypes[dateKey] ?? null,
                        dailyExtensions[dateKey] ?? 0
                      ).toFixed(1)}
                    </span>
                    <span className="text-sm font-medium text-[#64748b]">h</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#64748b] whitespace-nowrap">연장</span>
                    <input
                      type="number"
                      value={dailyExtensions[dateKey] ?? 0}
                      onChange={(e) => handleDailyExtensionChange(dateKey, Math.max(0, parseFloat(e.target.value) || 0))}
                      onBlur={(e) => {
                        const v = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0);
                        handleDailyExtensionChange(dateKey, v);
                      }}
                      step={0.5}
                      min={0}
                      readOnly={readOnly}
                      disabled={readOnly}
                      className={cn(
                        'w-12 px-2 py-1 text-sm font-medium text-[#1e293b] bg-background border border-[#e2e8f0] rounded-lg text-center focus:ring-2 focus:ring-[#02a1c0]/25',
                        readOnly && 'opacity-60 cursor-not-allowed'
                      )}
                    />
                    <span className="text-sm font-medium text-[#64748b]">h</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#64748b] whitespace-nowrap">주요</span>
                    <span className="text-sm font-semibold text-[#1e293b] tabular-nums">{totalDuration}h</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#64748b] whitespace-nowrap">미분류</span>
                    <span className="text-sm font-semibold text-[#1e293b] tabular-nums">
                      {Math.max(
                        0,
                        computeDailyWorkHoursLimit(
                          dailyLeaveTypes[dateKey] ?? null,
                          dailyExtensions[dateKey] ?? 0
                        ) - totalDuration
                      ).toFixed(1)}
                      h
                    </span>
                  </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
