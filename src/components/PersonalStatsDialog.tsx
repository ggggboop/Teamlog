import { useMemo, useState, useEffect } from 'react';
import { Target, Calendar, Layers } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { ko } from 'date-fns/locale';
import { TeamMember, WorkLog } from '@/types/workLog';
import { leaveTypeToUsedLeaveDays } from '@/utils/dailyWorkHours';
import { cn } from '@/lib/utils';
import { addDurations, finalizeDurationSum } from '@/utils/workLogNumeric';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PersonalStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember;
  logs: WorkLog[];
  categories: string[];
  currentDate: Date;
  /** 관리자 대시보드에서 열 때, 대시보드의 통계 기간과 동일하게 표시 */
  periodOverride?: { start: Date; end: Date };
  getDailyLeaveType?: (memberId: string, date: string) => Promise<string | null>;
}

type PeriodType = 'month' | 'year';

export function PersonalStatsDialog({
  open,
  onOpenChange,
  member,
  logs,
  categories,
  currentDate,
  periodOverride,
  getDailyLeaveType,
}: PersonalStatsDialogProps) {
  const [period, setPeriod] = useState<PeriodType>('month');
  const [leaveSummary, setLeaveSummary] = useState<Record<string, number>>({});
  const [selectedMajorForSub, setSelectedMajorForSub] = useState<string | null>(null);

  const stats = useMemo(() => {
    const safeCategories = categories || [];
    const WORK_KEYS = ['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'] as const;

    // Period boundaries: override(관리자 대시보드) 또는 내부 월간/연간
    const periodStart = periodOverride
      ? periodOverride.start
      : period === 'month'
        ? startOfMonth(currentDate)
        : startOfYear(currentDate);
    const periodEnd = periodOverride
      ? periodOverride.end
      : period === 'month'
        ? endOfMonth(currentDate)
        : endOfYear(currentDate);

    const periodStartStr = format(periodStart, 'yyyy-MM-dd');
    const periodEndStr = format(periodEnd, 'yyyy-MM-dd');

    const periodLogs = logs.filter(
      (l) =>
        l.memberId === member.id &&
        l.date >= periodStartStr &&
        l.date <= periodEndStr &&
        l.status !== '취소'
    );

    const totalHours = periodLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
    const totalTasks = periodLogs.length;
    const totalCount = periodLogs.reduce((sum, l) => sum + l.count, 0);
    const workIndicatorCounts: Record<string, number> = { 'R&R/루틴업무': 0, '현안대응': 0, '품질고도화 과제': 0, '조직운영관리': 0, '기타/행정': 0 };
    const workIndicatorHours: Record<string, number> = { 'R&R/루틴업무': 0, '현안대응': 0, '품질고도화 과제': 0, '조직운영관리': 0, '기타/행정': 0 };
    periodLogs.forEach((l) => {
      const w = l.workIndicator || '기타/행정';
      if (w in workIndicatorCounts) {
        workIndicatorCounts[w] += l.count;
        workIndicatorHours[w] = addDurations(workIndicatorHours[w] || 0, l.duration);
      }
    });

    const workIndicatorDetail = WORK_KEYS.map((w) => ({
      name: w,
      taskCount: workIndicatorCounts[w] || 0,
      hours: workIndicatorHours[w] || 0,
      pct: totalHours > 0 ? ((workIndicatorHours[w] || 0) / totalHours) * 100 : 0,
    }));

    const avgDensity = totalTasks > 0 ? finalizeDurationSum(totalHours / totalTasks) : 0;
    const workDays = new Set(periodLogs.map((l) => l.date)).size;
    const dailyAvgHours = workDays > 0 ? finalizeDurationSum(totalHours / workDays) : 0;
    const dailyAvgItemCount = workDays > 0 ? totalCount / workDays : 0;

    const majorNames = [...new Set(safeCategories.map((c) => (c.includes(' > ') ? c.split(' > ')[0]! : c)))];
    const majorCategoryStats = majorNames
      .map((major) => {
        const catLogs = periodLogs.filter((l) => l.category === major || l.category.startsWith(major + ' > '));
        const catHours = catLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
        const itemTotal = catLogs.reduce((sum, l) => sum + l.count, 0);
        return {
          category: major,
          taskCount: catLogs.length,
          totalCount: itemTotal,
          hours: catHours,
        };
      })
      .filter((s) => s.taskCount > 0)
      .sort((a, b) => b.hours - a.hours);

    const subCategoryStatsByMajor: Record<
      string,
      { category: string; displayName: string; taskCount: number; totalCount: number; hours: number }[]
    > = {};
    safeCategories.filter((c) => c.includes(' > ')).forEach((cat) => {
      const [major, sub] = cat.split(' > ');
      if (!major || !sub) return;
      const catLogs = periodLogs.filter((l) => l.category === cat);
      if (catLogs.length === 0) return;
      const catHours = catLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const itemTotal = catLogs.reduce((sum, l) => sum + l.count, 0);
      if (!subCategoryStatsByMajor[major]) subCategoryStatsByMajor[major] = [];
      subCategoryStatsByMajor[major].push({
        category: cat,
        displayName: sub.trim(),
        taskCount: catLogs.length,
        totalCount: itemTotal,
        hours: catHours,
      });
    });
    Object.keys(subCategoryStatsByMajor).forEach(major => {
      subCategoryStatsByMajor[major].sort((a, b) => b.hours - a.hours);
    });

    return {
      periodStart,
      periodEnd,
      totalHours,
      totalTasks,
      totalCount,
      avgDensity,
      workDays,
      dailyAvgHours,
      dailyAvgItemCount,
      workIndicatorDetail,
      majorCategoryStats,
      subCategoryStatsByMajor,
      totalHoursForMajorPct: totalHours,
    };
  }, [logs, member.id, categories, currentDate, period, periodOverride]);

  useEffect(() => {
    setSelectedMajorForSub(null);
  }, [stats.periodStart, stats.periodEnd, member.id, period, periodOverride]);

  useEffect(() => {
    if (!open || !getDailyLeaveType) return;
    const periodStart = periodOverride
      ? periodOverride.start
      : period === 'month'
        ? startOfMonth(currentDate)
        : startOfYear(currentDate);
    const periodEnd = periodOverride
      ? periodOverride.end
      : period === 'month'
        ? endOfMonth(currentDate)
        : endOfYear(currentDate);
    const days: string[] = [];
    const d = new Date(periodStart);
    while (d <= periodEnd) {
      days.push(format(d, 'yyyy-MM-dd'));
      d.setDate(d.getDate() + 1);
    }
    let cancelled = false;
    const load = async () => {
      const summary: Record<string, number> = {};
      for (const dateStr of days) {
        const lt = await getDailyLeaveType(member.id, dateStr);
        if (!cancelled && lt) {
          summary[lt] = (summary[lt] || 0) + 1;
        }
      }
      if (!cancelled) setLeaveSummary(summary);
    };
    load();
    return () => { cancelled = true; };
  }, [open, member.id, period, periodOverride, currentDate, getDailyLeaveType]);

  const leaveDaysWeighted = useMemo(() => {
    let s = 0;
    for (const [type, count] of Object.entries(leaveSummary)) {
      s += (count || 0) * leaveTypeToUsedLeaveDays(type);
    }
    return s;
  }, [leaveSummary]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto bg-gradient-to-b from-background to-muted/20 border-border/50">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-semibold tracking-tight">{member.name}님의 업무 통계</DialogTitle>
              <p className="text-base text-muted-foreground mt-1">
                {format(stats.periodStart, 'yyyy.MM.dd', { locale: ko })} —{' '}
                {format(stats.periodEnd, 'yyyy.MM.dd', { locale: ko })}
              </p>
            </div>
            {/* Period Toggle - override 시 숨김 */}
            {!periodOverride && (
              <div className="tab-group">
                <button
                  type="button"
                  onClick={() => setPeriod('month')}
                  className={cn('tab-item', period === 'month' && 'tab-item-active')}
                >
                  월간
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('year')}
                  className={cn('tab-item', period === 'year' && 'tab-item-active')}
                >
                  연간
                </button>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* 요약: 관리자 대시보드 업무 지표 분류 칸과 유사한 한 줄 요약 */}
          <div className="stat-card py-3 px-4">
            <div className="flex flex-wrap gap-x-4 gap-y-2 items-baseline text-base">
              <span>
                <span className="text-muted-foreground">총 업무시간 </span>
                <span className="font-semibold tabular-nums">{stats.totalHours.toFixed(1)}h</span>
              </span>
              <span>
                <span className="text-muted-foreground">총 업무건수 </span>
                <span className="font-semibold tabular-nums">{stats.totalCount}건</span>
              </span>
              <span>
                <span className="text-muted-foreground">평균 업무 밀도 </span>
                <span className="font-semibold tabular-nums">{stats.avgDensity.toFixed(2)}h</span>
              </span>
              <span>
                <span className="text-muted-foreground">실제 근무일 </span>
                <span className="font-semibold tabular-nums">{stats.workDays}일</span>
              </span>
            </div>
          </div>

          {/* 연차 현황 */}
          {getDailyLeaveType && Object.keys(leaveSummary).length > 0 && (
            <div className="stat-card">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="text-base font-semibold">연차/반차 현황</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {Object.entries(leaveSummary).map(([type, count]) => (
                  <span key={type} className="text-base">
                    <span className="text-muted-foreground">{type}</span>
                    <span className="font-bold ml-1">{count}일</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 업무 지표 분류 — 건수·기간 내 시간·비중 */}
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-base font-semibold">업무 지표 분류</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left py-2 px-2 font-semibold text-muted-foreground">지표</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground" title="건수란 합계">
                      실시 건수
                    </th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground">소요시간</th>
                    <th className="text-right py-2 px-2 font-semibold text-muted-foreground">비중</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.workIndicatorDetail.map(({ name, taskCount, hours, pct }) => (
                    <tr key={name} className="border-b border-border/30">
                      <td className="py-2 px-2 font-medium">{name}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{taskCount}건</td>
                      <td className="py-2 px-2 text-right tabular-nums text-primary font-semibold">{hours.toFixed(1)}h</td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="text-muted-foreground w-10 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 하루 평균 — 간단 한 줄 */}
          <div className="stat-card py-2.5 px-4">
            <span className="text-xs text-muted-foreground">하루 평균 </span>
            <span className="text-base font-medium tabular-nums">
              {stats.dailyAvgHours.toFixed(1)}h
            </span>
            <span className="text-xs text-muted-foreground mx-1.5">·</span>
            <span className="text-base font-medium tabular-nums">
              {stats.dailyAvgItemCount.toFixed(1)}건
            </span>
            <span className="text-[11px] text-muted-foreground ml-1" title="건수란 합계의 근무일당 평균">
              (근무일 기준·실시 건수)
            </span>
            {getDailyLeaveType && (
              <>
                <span className="text-xs text-muted-foreground mx-1.5">·</span>
                <span className="text-xs text-muted-foreground">사용 연차 </span>
                <span
                  className="text-base font-medium tabular-nums text-primary"
                  title="연차 1일 · 반차(각) 0.5일 · 반반차 0.25일 환산 합"
                >
                  {leaveDaysWeighted.toFixed(2)}일
                </span>
              </>
            )}
          </div>

          {/* 업무분류별 소요시간 — 대분류(좌) / 소분류(우) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="section-card flex flex-col min-h-[280px]">
              <div className="section-header">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <h3 className="text-base font-semibold">대분류별 소요시간</h3>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {stats.majorCategoryStats.length > 0 ? (
                  <table className="w-full text-base">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="text-left py-2 px-2 font-semibold text-muted-foreground">분류</th>
                        <th className="text-right py-2 px-2 font-semibold text-muted-foreground">소요시간</th>
                        <th className="text-right py-2 px-2 font-semibold text-muted-foreground" title="각 행 건수 합계">
                          업무건수
                        </th>
                        <th className="text-right py-2 px-2 font-semibold text-muted-foreground">비중</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.majorCategoryStats.map(({ category, totalCount: itemTotalCount, hours }) => {
                        const pct = stats.totalHoursForMajorPct > 0 ? (hours / stats.totalHoursForMajorPct) * 100 : 0;
                        const isSelected = selectedMajorForSub === category;
                        return (
                          <tr
                            key={category}
                            onClick={() => setSelectedMajorForSub(category)}
                            className={cn(
                              'border-b border-border/30 cursor-pointer hover:bg-muted/20 transition-colors',
                              isSelected && 'bg-primary/10'
                            )}
                          >
                            <td className="py-2 px-2 font-medium">{category}</td>
                            <td className="text-right py-2 px-2 font-semibold text-primary">{hours.toFixed(1)}h</td>
                            <td className="text-right py-2 px-2">{itemTotalCount}건</td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-muted-foreground w-8 text-xs">{pct.toFixed(0)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-base text-muted-foreground text-center py-8">해당 기간 업무 기록 없음</p>
                )}
              </div>
            </div>

            <div className="section-card flex flex-col min-h-[280px]">
              <div className="section-header">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <h3 className="text-base font-semibold">
                    소분류별 소요시간
                    {selectedMajorForSub && (
                      <span className="text-muted-foreground font-normal ml-1">— {selectedMajorForSub}</span>
                    )}
                  </h3>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {selectedMajorForSub ? (
                  stats.subCategoryStatsByMajor[selectedMajorForSub]?.length ? (
                    <table className="w-full text-base">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/30">
                          <th className="text-left py-2 px-2 font-semibold text-muted-foreground">분류</th>
                          <th className="text-right py-2 px-2 font-semibold text-muted-foreground">소요시간</th>
                          <th className="text-right py-2 px-2 font-semibold text-muted-foreground" title="각 행 건수 합계">
                            업무건수
                          </th>
                          <th className="text-right py-2 px-2 font-semibold text-muted-foreground">비중</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.subCategoryStatsByMajor[selectedMajorForSub].map(({ displayName, totalCount: itemTotalCount, hours }) => {
                          const majorHours =
                            stats.majorCategoryStats.find((m) => m.category === selectedMajorForSub)?.hours || 0;
                          const pct = majorHours > 0 ? (hours / majorHours) * 100 : 0;
                          return (
                            <tr key={displayName} className="border-b border-border/30">
                              <td className="py-2 px-2 font-medium">{displayName}</td>
                              <td className="text-right py-2 px-2 font-semibold text-primary">{hours.toFixed(1)}h</td>
                              <td className="text-right py-2 px-2">{itemTotalCount}건</td>
                              <td className="py-2 px-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-muted-foreground w-8 text-xs">{pct.toFixed(0)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-base text-muted-foreground text-center py-8">
                      이 대분류에 등록된 소분류 업무가 없습니다.
                    </p>
                  )
                ) : (
                  <div className="flex items-center justify-center h-full min-h-[200px] text-base text-muted-foreground">
                    {stats.majorCategoryStats.length > 0 ? '대분류를 선택하세요' : '—'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Info Note */}
          <p className="text-xs text-muted-foreground text-center py-2">
            본 통계는 자기 관리 및 업무 패턴 파악을 위한 참고 자료입니다.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
