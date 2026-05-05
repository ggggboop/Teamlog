import { WorkLog } from '@/types/workLog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type MergedTaskDetailLog = WorkLog;

interface TaskMergedDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 일자 오름차순 권장 */
  logs: MergedTaskDetailLog[] | null;
  memberName?: string;
  title?: string;
}

export function TaskMergedDetailDialog({
  open,
  onOpenChange,
  logs,
  memberName,
  title = '일자별 업무 기록',
}: TaskMergedDetailDialogProps) {
  const rows = logs && logs.length > 0 ? [...logs].sort((a, b) => a.date.localeCompare(b.date)) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-left">{title}</DialogTitle>
          {memberName ? (
            <p className="text-sm text-muted-foreground text-left">{memberName}</p>
          ) : null}
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">표시할 기록이 없습니다.</p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur z-10">
                <tr className="border-b border-border/60">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">날짜</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[120px]">업무내용</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">특이사항</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">건수</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">소요(h)</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">현황</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => {
                  const [major, sub] = log.category.includes(' > ')
                    ? log.category.split(' > ')
                    : [log.category, ''];
                  const catLabel = sub ? `${major} › ${sub}` : major;
                  return (
                    <tr key={log.id} className="border-b border-border/40 hover:bg-muted/30 align-top">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">{log.date}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground leading-snug">{log.content}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{catLabel}</p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground break-words max-w-[200px]">
                        {log.issues?.trim() ? log.issues : '—'}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{log.count}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{log.duration}</td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <span
                          className={
                            log.status === '완료'
                              ? 'text-green-700'
                              : log.status === '진행중'
                                ? 'text-amber-700'
                                : 'text-muted-foreground'
                          }
                        >
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
