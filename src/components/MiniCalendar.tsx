import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  setMonth,
  setYear,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { LEAVE_TYPE_OPTIONS } from '@/types/workLog';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface MiniCalendarProps {
  currentDate: Date;
  weekStart: Date;
  weekEnd: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onDateChange?: (date: Date) => void;
  /** 작성 화면 사이드바용 스타일 */
  worklogStyle?: boolean;
  /** yyyy-MM-dd — 해당 일자 아래 청록 점 표시(레이아웃·스타일은 유지, 점만 추가) */
  datesWithWorkRecords?: ReadonlySet<string>;
  /** 일자별 연차·반차 — 글자색·팝업 연동 */
  leaveByDate?: Record<string, string | null>;
  onLeaveChange?: (dateKey: string, value: string | null) => void;
  leavePickerReadOnly?: boolean;
}

const LEAVE_POPOVER_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: '없음' },
  ...LEAVE_TYPE_OPTIONS.map((v) => ({ value: v, label: v })),
];

/** 연차·반차·반반차 모두 동일 빨강 톤으로 표시 */
function leaveAccent(leave: string | null | undefined): { text: string; todayRing: string } {
  if (leave && (LEAVE_TYPE_OPTIONS as readonly string[]).includes(leave)) {
    return { text: 'text-rose-600', todayRing: 'ring-2 ring-rose-400/85 ring-inset' };
  }
  return { text: '', todayRing: '' };
}

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export function MiniCalendar({ 
  currentDate, 
  weekStart, 
  weekEnd,
  onPrevWeek,
  onNextWeek,
  onToday,
  onDateChange,
  worklogStyle = false,
  datesWithWorkRecords,
  leaveByDate,
  onLeaveChange,
  leavePickerReadOnly = false,
}: MiniCalendarProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerView, setPickerView] = useState<'month' | 'year'>('month');
  const [leavePopoverDayKey, setLeavePopoverDayKey] = useState<string | null>(null);

  const showLeavePicker = Boolean(worklogStyle && onLeaveChange && !leavePickerReadOnly);
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // 연도 범위 생성 (현재 연도 기준 ±5년)
  const yearRange = useMemo(() => {
    const years = [];
    for (let i = currentYear - 5; i <= currentYear + 5; i++) {
      years.push(i);
    }
    return years;
  }, [currentYear]);

  const isInSelectedWeek = (date: Date) => {
    return date >= weekStart && date <= weekEnd;
  };

  const handleMonthSelect = (monthIndex: number) => {
    const newDate = setMonth(currentDate, monthIndex);
    onDateChange?.(newDate);
    setIsPickerOpen(false);
  };

  const handleYearSelect = (year: number) => {
    const newDate = setYear(currentDate, year);
    onDateChange?.(newDate);
    setPickerView('month');
  };

  return (
    <div
      className={cn(
        worklogStyle ? 'worklog-mini-calendar-wrap' : 'p-4 border-t border-sidebar-border/50'
      )}
    >
      {/* 주차 네비게이션 */}
      <div className="flex items-center justify-between mb-2">
        <button 
          onClick={onPrevWeek} 
          className="p-2 rounded-xl hover:bg-muted/60 transition-all duration-200 active:scale-95"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <button 
          type="button"
          onClick={onToday} 
          className="px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-200 active:scale-95"
        >
          오늘로 이동
        </button>
        <button 
          onClick={onNextWeek} 
          className="p-2 rounded-xl hover:bg-muted/60 transition-all duration-200 active:scale-95"
        >
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="text-center mb-2">
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center justify-center gap-1 mx-auto px-3 py-1.5 rounded-xl hover:bg-muted/60 transition-all duration-200 active:scale-95 group">
              <span className="text-base font-semibold text-foreground tracking-tight">
                {format(currentDate, 'yyyy년 M월', { locale: ko })}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 bg-card border border-border/50 shadow-lg" align="center">
            {pickerView === 'month' ? (
              <div className="space-y-3">
                {/* 연도 선택 버튼 */}
                <button
                  onClick={() => setPickerView('year')}
                  className="w-full flex items-center justify-center gap-1 py-2 text-base font-semibold text-foreground hover:bg-muted/60 rounded-lg transition-colors"
                >
                  {currentYear}년
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                
                {/* 월 그리드 */}
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTHS.map((month, idx) => (
                    <button
                      key={month}
                      onClick={() => handleMonthSelect(idx)}
                      className={cn(
                        "py-2 text-xs font-medium rounded-lg transition-all duration-200",
                        idx === currentMonth
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "hover:bg-muted/60 text-foreground"
                      )}
                    >
                      {month}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 월 선택으로 돌아가기 */}
                <button
                  onClick={() => setPickerView('month')}
                  className="w-full flex items-center justify-center gap-1 py-2 text-base font-semibold text-primary hover:bg-primary/10 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  월 선택
                </button>
                
                {/* 연도 그리드 */}
                <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                  {yearRange.map((year) => (
                    <button
                      key={year}
                      onClick={() => handleYearSelect(year)}
                      className={cn(
                        "py-2 text-xs font-medium rounded-lg transition-all duration-200",
                        year === currentYear
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "hover:bg-muted/60 text-foreground"
                      )}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['월', '화', '수', '목', '금', '토', '일'].map((day, idx) => (
          <div 
            key={day} 
            className={cn(
              "text-[10px] text-center py-1 font-medium",
              idx >= 5 ? "text-muted-foreground/50" : "text-muted-foreground"
            )}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isToday = isSameDay(day, new Date());
          const isSelected = isInSelectedWeek(day);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          const dayKey = format(day, 'yyyy-MM-dd');
          const hasWorkRecord = datesWithWorkRecords?.has(dayKey) ?? false;
          const leave = leaveByDate?.[dayKey] ?? null;
          const accent = leaveAccent(leave);

          const dayNumberEl = (
            <span
              className={cn(
                'leading-none tabular-nums',
                isToday && 'text-primary-foreground',
                !isToday && leave && isCurrentMonth && accent.text,
                !isToday && leave && isCurrentMonth && 'font-semibold'
              )}
            >
              {format(day, 'd')}
            </span>
          );

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'aspect-square flex flex-col items-center justify-center gap-0.5 text-[11px] rounded-lg transition-all duration-200',
                !isCurrentMonth && 'text-muted-foreground/20',
                isCurrentMonth && !isSelected && !isWeekend && !leave && 'text-foreground/70',
                isCurrentMonth && !isSelected && isWeekend && !leave && 'text-muted-foreground/40',
                isSelected && !isToday && 'bg-primary/10',
                isSelected && !isToday && !leave && 'text-primary font-semibold',
                isToday &&
                  cn(
                    'bg-gradient-to-br from-primary to-primary-glow font-bold shadow-sm',
                    leave && accent.todayRing
                  ),
                isToday && !leave && 'text-primary-foreground'
              )}
            >
              {showLeavePicker ? (
                <Popover
                  open={leavePopoverDayKey === dayKey}
                  onOpenChange={(open) => setLeavePopoverDayKey(open ? dayKey : null)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!isCurrentMonth}
                      className={cn(
                        'flex flex-col items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md',
                        !isCurrentMonth && 'pointer-events-none opacity-40'
                      )}
                      aria-label={`${dayKey} 연차 설정`}
                    >
                      {dayNumberEl}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[11.5rem] p-1.5 shadow-lg" align="center" sideOffset={6}>
                    <p className="px-1.5 pb-1 text-[10px] font-medium text-muted-foreground">{dayKey}</p>
                    <ul className="flex flex-col gap-0.5">
                      {LEAVE_POPOVER_OPTIONS.map(({ value: v, label }) => (
                        <li key={label}>
                          <button
                            type="button"
                            className={cn(
                              'w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted',
                              (leave ?? null) === v && 'bg-primary/10 font-medium text-primary'
                            )}
                            onClick={() => {
                              onLeaveChange?.(dayKey, v);
                              setLeavePopoverDayKey(null);
                            }}
                          >
                            {label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              ) : (
                dayNumberEl
              )}
              <span
                className={cn(
                  'h-1 w-1 shrink-0 rounded-full',
                  hasWorkRecord ? 'bg-[#14b8a6]' : 'opacity-0 pointer-events-none'
                )}
                aria-hidden
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
