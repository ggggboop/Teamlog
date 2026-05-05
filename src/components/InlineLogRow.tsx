import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Trash2, X, Plus } from 'lucide-react';

/** 줄바꿈 시 높이 자동 확장 textarea (스크롤 없음) */
const AUTO_TEXTAREA_MIN_PX = 32;

function AutoResizeTextarea({ value, onChange, placeholder, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const syncHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, AUTO_TEXTAREA_MIN_PX)}px`;
  }, []);

  useEffect(() => {
    syncHeight();
  }, [value, syncHeight]);

  /** 창/그리드 너비가 바뀌면 줄 바꿈 수가 달라지는데 value는 그대로라 높이가 줄지 않던 문제 보완 */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      className={className}
      {...rest}
    />
  );
}
import {
  WorkLog,
  WorkCategory,
  WorkStatus,
  WorkIndicatorType,
  Category,
  WORK_INDICATOR_OPTIONS,
  WORK_STATUS,
} from '@/types/workLog';
import { cn } from '@/lib/utils';

/** DB 저장 시 블록 구분(줄바꿈만 있는 특이사항과 구분) */
const ISSUES_SEPARATOR = '\n\n';

function parseIssueLinesFromStored(raw?: string | null): string[] {
  if (raw == null || !String(raw).trim()) return [];
  const s = String(raw);
  return s.includes(ISSUES_SEPARATOR) ? s.split(ISSUES_SEPARATOR) : [s];
}

function joinIssueLines(lines: string[]): string {
  return lines.filter((x) => x.trim()).join(ISSUES_SEPARATOR);
}

export interface InlineLogRowData {
  id?: string;
  category: WorkCategory | '';
  content: string;
  issues: string;
  count: number | '';
  duration: number | '';
  status: WorkStatus | '';
  workIndicator: WorkIndicatorType | '';
  startDate: string;
  taskCode?: string;
  isNew: boolean;
  isEmpty: boolean;
}

export interface InlineLogRowHandle {
  getData: () => InlineLogRowData;
  setData: (data: Partial<InlineLogRowData>) => void;
  hasContent: () => boolean;
}

/** 미작성 필드명 (category, content, count, duration, status, workIndicator) - 붉은 테두리 표시용 */
export type InvalidFieldKey = 'category' | 'content' | 'count' | 'duration' | 'status' | 'workIndicator';

interface InlineLogRowProps {
  log?: WorkLog;
  memberId: string;
  date: string;
  rowNumber: number;
  categories: string[];
  categoriesTree?: Category[];
  onDelete?: (id: string) => void;
  onDeleteEmptyRow?: () => void;
  onDataChange?: () => void;
  isNew?: boolean;
  defaultStartDate?: string;
  /** 저장 실패 시 미작성 필드 목록 - 해당 필드에 붉은 테두리 표시 */
  invalidFields?: InvalidFieldKey[];
  /** true면 업무 필드·삭제 비활성(연차 등만 별도 저장) */
  workRecordLocked?: boolean;
  /** 비어 있지 않으면 대·소분류 목록을 즐겨찾기로 제한 */
  favoriteCategoryKeys?: string[];
  /** 팀원 로그 기준 taskCode → 최초 기록일 (저장 후 시작일 표시 유지) */
  taskCodeEarliestDateByCode?: Record<string, string>;
}

export const InlineLogRow = forwardRef<InlineLogRowHandle, InlineLogRowProps>(({
  log,
  memberId,
  date,
  rowNumber,
  categories,
  categoriesTree = [],
  onDelete,
  onDeleteEmptyRow,
  onDataChange,
  isNew = false,
  defaultStartDate,
  invalidFields = [],
  workRecordLocked = false,
  favoriteCategoryKeys = [],
  taskCodeEarliestDateByCode = {},
}, ref) => {
  const [category, setCategory] = useState<WorkCategory | ''>(log?.category || '');
  const [selectedMajorId, setSelectedMajorId] = useState<number | null>(null);
  const [content, setContent] = useState(log?.content || '');
  const [issueLines, setIssueLines] = useState<string[]>(() => parseIssueLinesFromStored(log?.issues));
  const [count, setCount] = useState<number | ''>(log?.count ?? '');
  const [duration, setDuration] = useState<number | ''>(log?.duration ?? '');
  const [status, setStatus] = useState<WorkStatus | ''>(log?.status || '');
  const [workIndicator, setWorkIndicator] = useState<WorkIndicatorType | ''>(log?.workIndicator || '');
  const [startDate, setStartDate] = useState(() => {
    if (log) {
      const tc = log.taskCode;
      if (tc && taskCodeEarliestDateByCode[tc]) return taskCodeEarliestDateByCode[tc]!;
      return log.date;
    }
    return defaultStartDate || date;
  });
  const [taskCode, setTaskCode] = useState<string | undefined>(log?.taskCode);

  const { majorCategories, subCategoriesByParent } = useMemo(() => {
    const normalized = categoriesTree.map(c => ({
      ...c,
      id: Number(c.id),
      parentId: c.parentId != null ? Number(c.parentId) : null,
      sortOrder: Number(c.sortOrder ?? 0),
    }));
    const majors = normalized.filter(c => c.parentId == null).sort((a, b) => a.sortOrder - b.sortOrder);
    const subsByParent = new Map<number, Category[]>();
    normalized.filter(c => c.parentId != null).forEach(c => {
      const pid = c.parentId!;
      const arr = subsByParent.get(pid) || [];
      arr.push(c);
      subsByParent.set(pid, arr);
    });
    subsByParent.forEach(arr => arr.sort((a, b) => a.sortOrder - b.sortOrder));
    return { majorCategories: majors, subCategoriesByParent: subsByParent };
  }, [categoriesTree]);

  const selectedMajor = useMemo(() => {
    if (category) {
      if (category.includes(' > ')) {
        const parentName = category.split(' > ')[0]?.trim();
        return majorCategories.find(m => m.name === parentName) ?? null;
      }
      return majorCategories.find(m => m.name === category) ?? null;
    }
    if (selectedMajorId != null) {
      return majorCategories.find(m => m.id === selectedMajorId) ?? null;
    }
    return null;
  }, [category, selectedMajorId, majorCategories]);

  const availableSubs = selectedMajor ? (subCategoriesByParent.get(selectedMajor.id) || []) : [];
  const majorSelectValue = selectedMajor ? String(selectedMajor.id) : (selectedMajorId != null ? String(selectedMajorId) : '');

  const favRestricted = favoriteCategoryKeys.length > 0 && categoriesTree.length > 0;

  const allowedMajorNames = useMemo(() => {
    if (!favRestricted) return null;
    const s = new Set<string>();
    for (const k of favoriteCategoryKeys) {
      const t = k.trim();
      if (!t) continue;
      if (t.includes(' > ')) s.add(t.split(' > ')[0]!.trim());
      else s.add(t);
    }
    return s;
  }, [favRestricted, favoriteCategoryKeys]);

  const majorsForSelect = useMemo(() => {
    if (!favRestricted || !allowedMajorNames) return majorCategories;
    const need = new Set(allowedMajorNames);
    if (category) {
      if (category.includes(' > ')) {
        const m = category.split(' > ')[0]?.trim();
        if (m) need.add(m);
      } else if (category.trim()) {
        need.add(category.trim());
      }
    }
    return majorCategories.filter((m) => need.has(m.name));
  }, [favRestricted, allowedMajorNames, majorCategories, category]);

  const allowedSubNamesForMajor = useMemo(() => {
    if (!favRestricted || !selectedMajor) return null;
    const prefix = `${selectedMajor.name} > `;
    const s = new Set<string>();
    for (const k of favoriteCategoryKeys) {
      const t = k.trim();
      if (t === selectedMajor.name) continue;
      if (t.startsWith(prefix)) s.add(t.slice(prefix.length).trim());
    }
    return s;
  }, [favRestricted, selectedMajor, favoriteCategoryKeys]);

  const subsForSelect = useMemo(() => {
    if (!selectedMajor) return [];
    if (!favRestricted) return availableSubs;
    const need = new Set(allowedSubNamesForMajor ?? []);
    if (category.includes(' > ')) {
      const parts = category.split(' > ').map((x) => x.trim());
      const maj = parts[0];
      const sub = parts[1];
      if (maj === selectedMajor.name && sub) need.add(sub);
    }
    return availableSubs.filter((s) => need.has(s.name));
  }, [favRestricted, selectedMajor, availableSubs, allowedSubNamesForMajor, category]);

  const showMajorDirectOption = useMemo(() => {
    if (!favRestricted) return true;
    if (!selectedMajor) return false;
    if (favoriteCategoryKeys.some((k) => k.trim() === selectedMajor.name)) return true;
    /** 기존 행이 대분류만으로 저장된 경우 선택 유지 */
    if (category.trim() === selectedMajor.name) return true;
    return false;
  }, [favRestricted, selectedMajor, favoriteCategoryKeys, category]);

  useEffect(() => {
    if (categoriesTree.length > 0 && rowNumber === 1) {
      const majors = majorCategories.length;
      const subsTotal = Array.from(subCategoriesByParent.values()).reduce((a, arr) => a + arr.length, 0);
      console.log('[InlineLogRow] 카테고리 구조:', { majors, subsTotal, majorSelectValue, selectedMajorId, category: category || '(빈값)', selectedMajor: selectedMajor?.name });
    }
  }, [categoriesTree.length, majorCategories.length, majorSelectValue, selectedMajorId, category, selectedMajor?.name, rowNumber]);

  // 저장된 행만 log와 동기화. isNew 행을 여기서 비우면 부모의 setData(진행중 불러오기)보다
  // 나중에 도는 useEffect가 입력을 지워 버림.
  useEffect(() => {
    if (log) {
      setCategory(log.category);
      setSelectedMajorId(null);
      setContent(log.content);
      setIssueLines(parseIssueLinesFromStored(log.issues));
      setCount(log.count);
      setDuration(log.duration);
      setStatus(log.status || '');
      setWorkIndicator(log.workIndicator);
      if (log.taskCode) {
        const earliest = taskCodeEarliestDateByCode[log.taskCode];
        setStartDate(earliest ?? log.date);
      } else {
        setStartDate(log.date);
      }
      setTaskCode(log.taskCode);
    }
  }, [log, taskCodeEarliestDateByCode]);

  useImperativeHandle(ref, () => ({
    getData: () => ({
      id: log?.id,
      category,
      content,
      issues: joinIssueLines(issueLines),
      count,
      duration,
      status,
      workIndicator,
      startDate,
      taskCode,
      isNew: isNew && !log,
      isEmpty: !content.trim(),
    }),
    setData: (data: Partial<InlineLogRowData>) => {
      if (data.category !== undefined) { setCategory(data.category); setSelectedMajorId(null); }
      if (data.content !== undefined) setContent(data.content);
      if (data.issues !== undefined) setIssueLines(parseIssueLinesFromStored(data.issues));
      if (data.count !== undefined) setCount(data.count);
      if (data.duration !== undefined) setDuration(data.duration);
      if (data.status !== undefined) setStatus(data.status);
      if (data.workIndicator !== undefined) setWorkIndicator(data.workIndicator);
      if (data.startDate !== undefined) setStartDate(data.startDate);
      if (data.taskCode !== undefined) setTaskCode(data.taskCode);
    },
    hasContent: () => content.trim().length > 0,
  }));

  const errClass = "border-red-500 focus:border-red-500 ring-2 ring-red-500/30";
  const inputClass =
    "h-8 text-sm rounded-lg border border-[#e2e8f0] bg-white text-[#1e293b] transition-all duration-200 focus:outline-none focus:border-[#02a1c0] focus:shadow-[0_0_0_3px_rgba(2,161,192,0.1)]";
  const selectClass =
    "h-8 text-sm rounded-lg border border-[#e2e8f0] bg-white text-[#1e293b] transition-all duration-200 focus:outline-none focus:border-[#02a1c0] focus:shadow-[0_0_0_3px_rgba(2,161,192,0.1)] cursor-pointer appearance-none";
  const inputWithErr = (field: InvalidFieldKey) => cn(inputClass, invalidFields.includes(field) && errClass);
  const selectWithErr = (field: InvalidFieldKey) => cn(selectClass, invalidFields.includes(field) && errClass);

  /** 주간 업무표 헤더·WeeklyRowView와 동일 트랙 — 업무·특이사항은 5번째 칸에서 세로로 묶음 */
  const rowGridClass =
    'grid grid-cols-[28px_44px_192px_216px_minmax(0,4fr)_50px_82px_132px_minmax(4.75rem,max-content)_28px] gap-2 items-start px-3 transition-colors duration-200 border-b border-black/[0.06] hover:bg-[#F8FAFC]';

  const handleMajorChange = (val: string) => {
    if (workRecordLocked) return;
    if (!val) {
      setSelectedMajorId(null);
      setCategory('');
      return;
    }
    const majorId = parseInt(val, 10);
    const major = majorCategories.find(m => m.id === majorId);
    const subs = subCategoriesByParent.get(majorId);
    if (!major) {
      console.warn('[InlineLogRow] 대분류 선택 실패: majorId=', majorId, 'majorCategories=', majorCategories.map(m => ({ id: m.id, name: m.name })));
      return;
    }
    setSelectedMajorId(majorId);
    if (subs && subs.length > 0) {
      setCategory('');
    } else {
      setCategory(major.name);
    }
  };

  const handleSubChange = (val: string) => {
    if (workRecordLocked) return;
    if (!val || !selectedMajor) return;
    if (val === '__none__') {
      setCategory(selectedMajor.name);
      setSelectedMajorId(null);
    } else {
      const subId = parseInt(val, 10);
      const sub = availableSubs.find(s => s.id === subId);
      if (sub) {
        setCategory(`${selectedMajor.name} > ${sub.name}`);
        setSelectedMajorId(null);
      } else {
        console.warn('[InlineLogRow] 소분류 선택 실패: subId=', subId, 'availableSubs=', availableSubs.map(s => ({ id: s.id, name: s.name })));
      }
    }
  };

  const subSelectValue = category.includes(' > ') && selectedMajor
    ? String(availableSubs.find(s => `${selectedMajor.name} > ${s.name}` === category)?.id ?? '')
    : category === selectedMajor?.name ? '__none__' : '';

  return (
    <div className="group flex flex-col">
      <div className={cn(rowGridClass, 'py-2')}>
        {/* 순번 */}
        <div className="text-sm font-medium text-[#64748b] text-center self-center tabular-nums">
          {rowNumber}
        </div>

        {/* 시작일 (표시 전용 — 진행중 불러오기 시 최초 일자가 다른 날이면 청록 강조) */}
        <div className="flex justify-center self-center">
          <span
            className={cn(
              'text-sm font-medium px-1 py-0.5 whitespace-nowrap tabular-nums',
              startDate === date ? 'text-[#64748b]' : 'font-semibold text-[#02a1c0]'
            )}
            title="해당 업무를 최초로 기록한 날짜"
          >
            {startDate === date ? '오늘' : startDate.slice(5).replace('-', '/')}
          </span>
        </div>

        {/* 대분류 */}
        <div className="min-w-0 self-center">
          {categoriesTree.length > 0 ? (
            <select
              value={majorSelectValue}
              onChange={(e) => handleMajorChange(e.target.value)}
              disabled={workRecordLocked}
              className={cn(selectWithErr('category'), "px-1.5 bg-white w-full font-medium", !selectedMajor && "text-[#94a3b8]", workRecordLocked && "opacity-60 cursor-not-allowed")}
            >
              <option value="">대분류</option>
              {majorsForSelect.map((m) => (
                <option key={m.id} value={String(m.id)}>{m.name}</option>
              ))}
            </select>
          ) : (
            <select value={category} onChange={(e) => !workRecordLocked && setCategory(e.target.value as WorkCategory | '')}
              disabled={workRecordLocked}
              className={cn(selectWithErr('category'), "px-2 bg-white w-full font-medium", !category && "text-[#94a3b8]", workRecordLocked && "opacity-60 cursor-not-allowed")}>
              <option value="">선택</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>

        {/* 소분류 */}
        <div className="min-w-0 self-center">
          {categoriesTree.length > 0 && selectedMajor ? (
            <select
              value={subSelectValue}
              onChange={(e) => handleSubChange(e.target.value)}
              disabled={workRecordLocked}
              className={cn(selectWithErr('category'), "px-1.5 bg-white w-full font-medium", !category && "text-[#94a3b8]", workRecordLocked && "opacity-60 cursor-not-allowed")}
            >
              <option value="">소분류</option>
              {availableSubs.length > 0 ? (
                <>
                  {showMajorDirectOption ? (
                    <option value="__none__">{selectedMajor.name} (직접)</option>
                  ) : null}
                  {subsForSelect.map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  ))}
                </>
              ) : (
                <option value="__none__">{selectedMajor.name}</option>
              )}
            </select>
          ) : (
            <span className="text-sm font-medium text-[#94a3b8] px-1">-</span>
          )}
        </div>

        {/* 업무내용(넓음) · 우측 + · 특이사항은 항상 아래 줄·동일 가로 폭 */}
        <div className="min-w-0 self-start w-full flex flex-col gap-1.5">
          <div className="flex gap-1.5 items-start min-w-0 w-full">
            <AutoResizeTextarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="업무내용"
              readOnly={workRecordLocked}
              disabled={workRecordLocked}
              className={cn(
                inputWithErr('content'),
                'flex-1 min-w-0 px-2.5 py-1.5 min-h-[2rem] text-sm font-medium resize-none overflow-hidden placeholder:text-[#94a3b8] whitespace-pre-wrap break-words leading-snug',
                workRecordLocked && 'opacity-60 cursor-not-allowed bg-muted/30'
              )}
            />
            {!workRecordLocked ? (
              <button
                type="button"
                title="특이사항 줄 추가"
                className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#e2e8f0] bg-white text-[#64748b] transition-colors hover:border-[#02a1c0]/50 hover:bg-[#ecfeff]/60 hover:text-[#02a1c0]"
                onClick={() => setIssueLines((prev) => [...prev, ''])}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          {issueLines.map((line, idx) => (
            <div key={`issue-${idx}`} className="relative w-full min-w-0">
              <AutoResizeTextarea
                value={line}
                onChange={(e) => {
                  const v = e.target.value;
                  setIssueLines((prev) => prev.map((x, i) => (i === idx ? v : x)));
                }}
                placeholder={issueLines.length > 1 ? `특이사항 ${idx + 1}` : '특이사항'}
                readOnly={workRecordLocked}
                disabled={workRecordLocked}
                className={cn(
                  inputClass,
                  'px-2 py-1.5 w-full min-h-[2rem] text-sm font-medium resize-none overflow-hidden placeholder:text-[#94a3b8] whitespace-pre-wrap break-words leading-snug pr-7 text-[13px]',
                  workRecordLocked && 'opacity-60 cursor-not-allowed bg-muted/30'
                )}
              />
              {!workRecordLocked ? (
                <button
                  type="button"
                  title="이 특이사항 칸 제거"
                  className="absolute right-0.5 top-1 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setIssueLines((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {/* 건수 */}
        <div className="flex items-center justify-center gap-0.5 self-center min-w-0 w-full">
          <input
            type="number"
            value={count}
            onChange={(e) => { setCount(e.target.value === '' ? '' : Number(e.target.value)); onDataChange?.(); }}
            placeholder="-"
            min={1}
            readOnly={workRecordLocked}
            disabled={workRecordLocked}
            className={cn(inputWithErr('count'), "w-10 min-w-0 max-w-full text-center px-0.5 text-sm font-medium tabular-nums placeholder:text-[#94a3b8]", workRecordLocked && "opacity-60 cursor-not-allowed")}
          />
          <span className="text-sm font-medium text-[#64748b] shrink-0 whitespace-nowrap">건</span>
        </div>

        {/* 총 소요시간 */}
        <div className="flex items-center justify-center gap-0.5 self-center min-w-0 w-full">
          <input
            type="number"
            value={duration}
            onChange={(e) => { setDuration(e.target.value === '' ? '' : Number(e.target.value)); onDataChange?.(); }}
            placeholder="-"
            step={0.5}
            min={0.5}
            readOnly={workRecordLocked}
            disabled={workRecordLocked}
            className={cn(inputWithErr('duration'), "w-11 min-w-0 max-w-full text-center px-0.5 text-sm font-medium tabular-nums duration-spinner placeholder:text-[#94a3b8]", workRecordLocked && "opacity-60 cursor-not-allowed")}
          />
          <span className="text-sm font-medium text-[#64748b] shrink-0 whitespace-nowrap">h</span>
        </div>

        {/* 업무 지표 */}
        <select
          value={workIndicator}
          onChange={(e) => setWorkIndicator(e.target.value as WorkIndicatorType | '')}
          disabled={workRecordLocked}
          className={cn(
            selectWithErr('workIndicator'),
            "px-1 text-center text-sm font-medium self-center min-w-0 w-full max-w-full border-[#cbd5e1] bg-[#f1f5f9] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]",
            workIndicator ? "text-[#334155]" : "text-[#94a3b8]",
            workRecordLocked && "opacity-60 cursor-not-allowed"
          )}
        >
          <option value="">선택</option>
          {WORK_INDICATOR_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

        {/* 현황 */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as WorkStatus | '')}
          disabled={workRecordLocked}
          className={cn(
            selectWithErr('status'),
            "px-1.5 text-center text-sm font-medium self-center min-w-0 w-full whitespace-nowrap bg-white border-[#e2e8f0] shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]",
            status === '완료' ? "text-[#047857]" :
            status === '진행중' ? "text-[#b45309]" :
            status === '취소' ? "text-[#64748b]" : "text-[#94a3b8]",
            workRecordLocked && "opacity-60 cursor-not-allowed"
          )}
        >
          <option value="">선택</option>
          {WORK_STATUS.map((s) => (
            <option key={s} value={s} className="whitespace-nowrap">{s}</option>
          ))}
        </select>

        {/* 삭제 */}
        <div className="flex justify-center self-center">
          {log ? (
            onDelete && !workRecordLocked && (
              <button
                type="button"
                onClick={() => onDelete(log.id)}
                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all duration-200 active:scale-90"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
              </button>
            )
          ) : (
            onDeleteEmptyRow && !workRecordLocked && (
              <button
                type="button"
                onClick={onDeleteEmptyRow}
                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all duration-200 active:scale-90"
              >
                <Trash2 className="w-3.5 h-3.5 text-muted-foreground/50" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
});

InlineLogRow.displayName = 'InlineLogRow';
