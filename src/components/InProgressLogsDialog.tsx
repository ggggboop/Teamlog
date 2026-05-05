import { useState, useMemo, useEffect } from 'react';
import { Download, Calendar } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import { WorkLog } from '@/types/workLog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface InProgressLogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logs: WorkLog[];
  onLoadLog: (log: WorkLog) => void;
  defaultYear?: number;
  defaultMonth?: number;
}

const YEARS = Array.from({ length: 9 }, (_, i) => new Date().getFullYear() - 4 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function InProgressLogsDialog({
  open,
  onOpenChange,
  logs,
  onLoadLog,
  defaultYear,
  defaultMonth,
}: InProgressLogsDialogProps) {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(defaultYear ?? now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth ?? now.getMonth() + 1);

  useEffect(() => {
    if (open && defaultYear != null) setSelectedYear(defaultYear);
    if (open && defaultMonth != null) setSelectedMonth(defaultMonth);
  }, [open, defaultYear, defaultMonth]);

  const inProgressLogs = useMemo(() => {
    const monthStart = startOfMonth(new Date(selectedYear, selectedMonth - 1));
    const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth - 1));
    const startStr = format(monthStart, 'yyyy-MM-dd');
    const endStr = format(monthEnd, 'yyyy-MM-dd');

    return logs
      .filter(log => log.status === '진행중' && log.date >= startStr && log.date <= endStr)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [logs, selectedYear, selectedMonth]);

  const handleLoad = (log: WorkLog) => {
    onLoadLog(log);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            진행중 업무 추가
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            원본 기록은 그대로 두고, 선택한 업무를 <strong className="text-foreground font-medium">주간 화면에서 &quot;진행중 업무 추가&quot;를 누른 그 날짜</strong>에 새 행으로 불러옵니다.
            같은 <code className="text-xs bg-muted px-1 rounded">taskCode</code>로 이어지므로 이후 저장 시 소요시간이 합산됩니다.
            통계·기록 목록에서는 같은 업무로 묶인 행의 <strong className="text-foreground font-medium">시간·건수가 합산</strong>되고, 보이는 업무 내용은 보통 <strong className="text-foreground font-medium">가장 최근 기록</strong> 기준입니다. (상단 &quot;진행중 안내&quot; 참고)
          </p>
        </DialogHeader>

        {/* 연도/월 선택 */}
        <div className="flex items-center gap-3 mt-2 p-3 bg-muted/30 rounded-xl">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-base font-medium text-muted-foreground">기간 선택:</span>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="h-9 px-3 text-base rounded-lg border border-input bg-background"
          >
            {YEARS.map(y => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="h-9 px-3 text-base rounded-lg border border-input bg-background"
          >
            {MONTHS.map(m => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <span className="text-base text-muted-foreground">
            ({selectedYear}년 {selectedMonth}월 — {inProgressLogs.length}건)
          </span>
        </div>

        <div className="flex-1 overflow-auto mt-4">
          {inProgressLogs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-base">
              {selectedYear}년 {selectedMonth}월에 진행중인 업무가 없습니다.
            </div>
          ) : (
            <div className="space-y-1">
              {/* Table Header */}
              <div className="grid grid-cols-[100px_1fr_minmax(4.5rem,min-content)_minmax(4.5rem,min-content)_minmax(6.5rem,max-content)] gap-3 px-4 py-2.5 bg-muted/30 rounded-lg text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <div>날짜</div>
                <div>업무 내용</div>
                <div className="text-center whitespace-nowrap">업무지표</div>
                <div className="text-center whitespace-nowrap">현황</div>
                <div className="text-center whitespace-nowrap">이 날짜에 불러오기</div>
              </div>

              {/* Log Rows */}
              {inProgressLogs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[100px_1fr_minmax(4.5rem,min-content)_minmax(4.5rem,min-content)_minmax(6.5rem,max-content)] gap-3 px-4 py-3 bg-card hover:bg-secondary/40 rounded-xl transition-colors duration-200 items-center text-base"
                >
                  <div className="text-base text-muted-foreground whitespace-nowrap tabular-nums">
                    {format(new Date(log.date), 'MM/dd (EEE)', { locale: ko })}
                  </div>
                  <div className="text-base font-medium truncate min-w-0">
                    {log.content}
                  </div>
                  <div className="flex justify-center min-w-0">
                    <span className="px-2 py-1 text-xs font-medium rounded-lg bg-muted/80 text-muted-foreground whitespace-nowrap max-w-full truncate">
                      {log.workIndicator}
                    </span>
                  </div>
                  <div className="flex justify-center">
                    <span className="px-2 py-1 text-xs font-medium bg-warning/10 text-warning rounded-lg whitespace-nowrap">
                      진행중
                    </span>
                  </div>
                  <div className="flex justify-center">
                    <button
                      onClick={() => handleLoad(log)}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-base font-medium text-primary hover:bg-primary/10 rounded-lg transition-all duration-200 active:scale-95 whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      불러오기
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
