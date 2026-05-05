import { useMemo, useState } from 'react';
import { format, endOfMonth, endOfYear } from 'date-fns';
import { TeamMember, WorkLog } from '@/types/workLog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { TaskMergedDetailDialog } from '@/components/TaskMergedDetailDialog';
import { addDurations } from '@/utils/workLogNumeric';

interface PersonalRecordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember;
  logs: WorkLog[];
}

export function PersonalRecordsDialog({
  open,
  onOpenChange,
  member,
  logs,
}: PersonalRecordsDialogProps) {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [mergedTaskDetailLogs, setMergedTaskDetailLogs] = useState<WorkLog[] | null>(null);

  const periodStart = period === 'month' ? new Date(year, month - 1, 1) : new Date(year, 0, 1);
  const periodEnd = period === 'month' ? endOfMonth(periodStart) : endOfYear(periodStart);
  const startStr = format(periodStart, 'yyyy-MM-dd');
  const endStr = format(periodEnd, 'yyyy-MM-dd');

  const memberLogs = useMemo(() => {
    return logs
      .filter(l => l.memberId === member.id && l.date >= startStr && l.date <= endStr)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [logs, member.id, startStr, endStr]);

  // 동일 taskCode: 소요시간 합산(진행/완료 혼합)
  const displayLogs = useMemo(() => {
    const byTask = new Map<string, { logs: WorkLog[]; duration: number; dates: string[] }>();
    const noCode: WorkLog[] = [];
    memberLogs.forEach(log => {
      if (!log.taskCode) {
        noCode.push(log);
        return;
      }
      const key = log.taskCode;
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
      const anyInProgress = taskLogs.some(l => l.status === '진행중');
      const sortedTaskLogs = [...taskLogs].sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...latest,
        duration,
        date: sortedDates.length > 1 ? `${sortedDates[0]} 외 ${sortedDates.length - 1}일` : sortedDates[0],
        _sortDate: sortedDates[0],
        status: anyInProgress ? ('진행중' as const) : latest.status,
        _mergedTaskLogs: sortedTaskLogs,
      };
    });
    return [...groupedList, ...noCode].sort((a, b) => {
      const da = (a as { _sortDate?: string })._sortDate || a.date;
      const db = (b as { _sortDate?: string })._sortDate || b.date;
      return da.localeCompare(db);
    });
  }, [memberLogs]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[112rem] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{member.name} 업무 기록</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="text-base bg-muted/50 border border-border rounded-md px-2 py-1.5">
              {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            {period === 'month' && (
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="text-base bg-muted/50 border border-border rounded-md px-2 py-1.5">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            )}
            <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
              <button onClick={() => setPeriod('month')} className={cn("px-3 py-1.5 text-base rounded-md", period === 'month' ? "bg-card shadow-sm" : "text-muted-foreground")}>월간</button>
              <button onClick={() => setPeriod('year')} className={cn("px-3 py-1.5 text-base rounded-md", period === 'year' ? "bg-card shadow-sm" : "text-muted-foreground")}>연간</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto rounded-lg border-2 border-border">
            <table className="w-full text-base border-collapse">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="px-3 py-2.5 text-left text-base font-semibold text-muted-foreground whitespace-nowrap">날짜</th>
                  <th className="px-3 py-2.5 text-left text-base font-semibold text-muted-foreground">대분류</th>
                  <th className="px-3 py-2.5 text-left text-base font-semibold text-muted-foreground">소분류</th>
                  <th className="px-3 py-2.5 text-left text-base font-semibold text-muted-foreground min-w-[140px]">업무내용</th>
                  <th className="px-3 py-2.5 text-left text-base font-semibold text-muted-foreground min-w-[100px]">특이사항</th>
                  <th className="px-3 py-2.5 text-center text-base font-semibold text-muted-foreground whitespace-nowrap">건수</th>
                  <th className="px-3 py-2.5 text-center text-base font-semibold text-muted-foreground whitespace-nowrap">소요시간</th>
                  <th className="px-3 py-2.5 text-center text-base font-semibold text-muted-foreground whitespace-nowrap">업무지표</th>
                  <th className="px-3 py-2.5 text-center text-base font-semibold text-muted-foreground whitespace-nowrap">현황</th>
                </tr>
              </thead>
              <tbody>
                {displayLogs.map((log) => {
                  const [major, sub] = log.category.includes(' > ') ? log.category.split(' > ') : [log.category, ''];
                  const rowKey = log.taskCode ?? log.id;
                  const isMergedTask =
                    Boolean(log.taskCode) && typeof log.date === 'string' && log.date.includes('외') && log.date.includes('일');
                  return (
                    <tr key={rowKey} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-base">
                        {isMergedTask ? (
                          <button
                            type="button"
                            className="text-left text-[#02a1c0] font-medium underline-offset-2 hover:underline whitespace-nowrap tabular-nums"
                            onClick={() => {
                              setMergedTaskDetailLogs((log as WorkLog & { _mergedTaskLogs?: WorkLog[] })._mergedTaskLogs ?? []);
                            }}
                          >
                            {log.date}
                          </button>
                        ) : (
                          <span className="text-muted-foreground whitespace-nowrap tabular-nums">{log.date}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-base">{major}</td>
                      <td className="px-3 py-2 text-base text-muted-foreground">{sub || '-'}</td>
                      <td className="px-3 py-2 text-base">{log.content}</td>
                      <td className="px-3 py-2 text-base text-muted-foreground">{log.issues || '-'}</td>
                      <td className="px-3 py-2 text-base text-center">{log.count}</td>
                      <td className="px-3 py-2 text-base text-center tabular-nums">{log.duration}h</td>
                      <td className="px-3 py-2 text-base text-center">{log.workIndicator || '기타/행정'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded text-base font-medium whitespace-nowrap",
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
          <p className="text-base text-muted-foreground mt-2">총 {displayLogs.length}건</p>
        </DialogContent>
      </Dialog>

      <TaskMergedDetailDialog
        open={mergedTaskDetailLogs !== null && mergedTaskDetailLogs.length > 0}
        onOpenChange={(o) => {
          if (!o) setMergedTaskDetailLogs(null);
        }}
        logs={mergedTaskDetailLogs}
        memberName={member.name}
        title="일자별 업무 기록"
      />
    </>
  );
}
