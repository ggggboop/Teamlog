import { useMemo, useState, useEffect } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  eachDayOfInterval,
  isWeekend,
  parse,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TeamMember, WorkLog, WorkTeam } from '@/types/workLog';
import { cn } from '@/lib/utils';
import { addDurations } from '@/utils/workLogNumeric';

const STANDARD_DAY_HOURS = 8;
const PIE_COLORS = ['#02a1c0', '#94a3b8'];

/** 근로일수·가동률 분모: 실제 업무 기록이 있는 날만 (연·반차만 있는 날 제외) */
function logCountsAsTeamWorkday(l: WorkLog): boolean {
  if (l.status === '취소') return false;
  return (
    l.duration > 0 ||
    l.count > 0 ||
    (typeof l.content === 'string' && l.content.trim().length > 0)
  );
}

interface SummaryDashboardTabProps {
  members: TeamMember[];
  teams: WorkTeam[];
  logs: WorkLog[];
  statsPeriod: 'month' | 'year';
  statsYear: number;
  statsMonth: number;
  setStatsPeriod: (v: 'month' | 'year') => void;
  setStatsYear: (v: number) => void;
  setStatsMonth: (v: number) => void;
  getDailyTotalWorkHours?: (memberId: string, date: string) => Promise<number>;
}

export function SummaryDashboardTab({
  members,
  teams: _teams,
  logs,
  statsPeriod,
  statsYear,
  statsMonth,
  setStatsPeriod,
  setStatsYear,
  setStatsMonth,
  getDailyTotalWorkHours,
}: SummaryDashboardTabProps) {
  const selectedDate = useMemo(() => new Date(statsYear, statsMonth - 1, 1), [statsYear, statsMonth]);
  const periodStart = statsPeriod === 'month' ? startOfMonth(selectedDate) : startOfYear(selectedDate);
  const periodEnd = statsPeriod === 'month' ? endOfMonth(selectedDate) : endOfYear(selectedDate);
  const startStr = format(periodStart, 'yyyy-MM-dd');
  const endStr = format(periodEnd, 'yyyy-MM-dd');

  const workdayDates = useMemo(
    () => eachDayOfInterval({ start: periodStart, end: periodEnd }).filter((d) => !isWeekend(d)),
    [periodStart, periodEnd]
  );
  const workdayCount = workdayDates.length;

  const teamMemberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const periodLogs = useMemo(() => {
    return logs.filter(
      (l) =>
        teamMemberIds.has(l.memberId) &&
        l.date >= startStr &&
        l.date <= endStr &&
        l.status !== '취소'
    );
  }, [logs, teamMemberIds, startStr, endStr]);

  const periodLogsWorkdays = useMemo(
    () => periodLogs.filter(logCountsAsTeamWorkday),
    [periodLogs]
  );

  /** 기간 내 팀원 중 누구든 실질 업무 기록이 있는 고유 일수(연·반차만인 날 제외, 주말 기록 포함) */
  const teamRecordedUniqueDayCount = useMemo(
    () => new Set(periodLogsWorkdays.map((l) => l.date)).size,
    [periodLogsWorkdays]
  );

  /** 기간 내 실질 업무가 있는 평일 수(토·일 제외) — 가동률 분모에 사용 */
  const activeWeekdayCount = useMemo(() => {
    const dates = new Set(periodLogsWorkdays.map((l) => l.date));
    let n = 0;
    for (const ds of dates) {
      const d = parse(ds, 'yyyy-MM-dd', new Date());
      if (!isWeekend(d)) n += 1;
    }
    return n;
  }, [periodLogsWorkdays]);

  /** 업무기록 행마다 입력한 「건수」 합계 (2면 2로 집계). taskCode 묶음 개수와 다름 */
  const totalTaskCountSum = useMemo(
    () => periodLogs.reduce((s, l) => s + l.count, 0),
    [periodLogs]
  );

  const totalLoggedHours = useMemo(
    () => periodLogs.reduce((s, l) => addDurations(s, l.duration), 0),
    [periodLogs]
  );

  const loggedByMemberDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of periodLogsWorkdays) {
      const k = `${l.memberId}|${l.date}`;
      m.set(k, addDurations(m.get(k) ?? 0, l.duration));
    }
    return m;
  }, [periodLogsWorkdays]);

  /** 실질 업무가 있는 (팀원, 날짜)만 — 로그 없는 평일은 미분류에 8h씩 누적되지 않도록 함 */
  const memberDatePairsWithLogs = useMemo(() => {
    const set = new Set<string>();
    for (const l of periodLogsWorkdays) {
      set.add(`${l.memberId}\t${l.date}`);
    }
    return [...set].map((row) => {
      const tab = row.indexOf('\t');
      return { memberId: row.slice(0, tab), date: row.slice(tab + 1) };
    });
  }, [periodLogsWorkdays]);

  const headcount = members.length;

  const [capSum, setCapSum] = useState(0);
  const [unclassifiedSum, setUnclassifiedSum] = useState(0);
  const [loadingCaps, setLoadingCaps] = useState(false);

  useEffect(() => {
    if (members.length === 0 || memberDatePairsWithLogs.length === 0) {
      setCapSum(0);
      setUnclassifiedSum(0);
      setLoadingCaps(false);
      return;
    }
    const memberByIdMap = new Map(members.map((m) => [m.id, m]));
    const flat = memberDatePairsWithLogs
      .map(({ memberId, date: ds }) => {
        const m = memberByIdMap.get(memberId);
        return m ? { m, ds } : null;
      })
      .filter((x): x is { m: TeamMember; ds: string } => x != null);

    let cancelled = false;
    setLoadingCaps(true);
    (async () => {
      try {
        const chunkSize = 80;
        let cap = 0;
        let uncl = 0;
        for (let i = 0; i < flat.length; i += chunkSize) {
          if (cancelled) return;
          const slice = flat.slice(i, i + chunkSize);
          const part = await Promise.all(
            slice.map(async ({ m, ds }) => {
              const logged = loggedByMemberDate.get(`${m.id}|${ds}`) ?? 0;
              const daily =
                getDailyTotalWorkHours != null
                  ? await getDailyTotalWorkHours(m.id, ds)
                  : STANDARD_DAY_HOURS;
              const c = Number.isFinite(daily) && daily >= 0 ? daily : STANDARD_DAY_HOURS;
              return { cap: c, un: Math.max(0, c - logged) };
            })
          );
          for (const p of part) {
            cap += p.cap;
            uncl += p.un;
          }
        }
        if (!cancelled) {
          setCapSum(cap);
          setUnclassifiedSum(uncl);
        }
      } finally {
        if (!cancelled) setLoadingCaps(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [members, memberDatePairsWithLogs, getDailyTotalWorkHours, loggedByMemberDate]);

  /** 가동률: 기록이 있는 평일만 분모에 반영 (전체 기간 평일×인원 대체) */
  const utilizationDenominatorHours = activeWeekdayCount * headcount * STANDARD_DAY_HOURS;

  const utilizationPct =
    utilizationDenominatorHours > 0
      ? Math.min(999, (totalLoggedHours / utilizationDenominatorHours) * 100)
      : 0;

  const pieData = [
    { name: '주요(기록)', value: Math.round(totalLoggedHours * 10) / 10 },
    { name: '미분류', value: Math.round(unclassifiedSum * 10) / 10 },
  ].filter((d) => d.value > 0);

  const periodLabel =
    statsPeriod === 'month'
      ? `${statsYear}년 ${statsMonth}월`
      : `${statsYear}년`;

  return (
    <div className="space-y-6">
      <div className="worklog-toolbar">
        <div className="worklog-period-strip">
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
        <span className="text-sm text-[#64748b] truncate min-w-0">
          기간: {format(periodStart, 'yyyy.MM.dd', { locale: ko })} —{' '}
          {format(periodEnd, 'MM.dd', { locale: ko })} · 평일 {workdayCount}일
        </span>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-[#64748b]">표시할 팀원이 없습니다. 팀을 선택하거나 팀원을 등록하세요.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="stat-card py-4">
              <p className="text-xs font-medium text-[#64748b]">근로일수</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1e293b]">
                {teamRecordedUniqueDayCount}
              </p>
              <p className="mt-0.5 text-[11px] text-[#94a3b8]">
                {periodLabel} · 실질 업무 기록이 있는 날(고유)
              </p>
            </div>
            <div className="stat-card py-4">
              <p className="text-xs font-medium text-[#64748b]">총 업무시간(총 공수)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#02a1c0]">
                {totalLoggedHours.toFixed(1)}
                <span className="text-base font-medium text-[#94a3b8] ml-0.5">h</span>
              </p>
              <p className="mt-0.5 text-[11px] text-[#94a3b8]">취소 제외 · 기록 소요 합</p>
            </div>
            <div className="stat-card py-4">
              <p className="text-xs font-medium text-[#64748b]">실시 업무건수</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1e293b]">{totalTaskCountSum}</p>
              <p className="mt-0.5 text-[11px] text-[#94a3b8]">각 행 건수 합계</p>
            </div>
            <div className="stat-card py-4">
              <p className="text-xs font-medium text-[#64748b]">가동률</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#02a1c0]">
                {utilizationPct.toFixed(1)}%
              </p>
              <p className="mt-0.5 text-[11px] text-[#94a3b8]">
                기록h ÷ (활동 평일 {activeWeekdayCount}일×{headcount}명×8h)
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="section-card p-5">
              <h3 className="text-base font-semibold text-[#1e293b]">주요 vs 미분류 (시간)</h3>
              <p className="mt-1 text-xs text-[#64748b]">
                주요: 업무 기록 소요시간 합 · 미분류: (기록이 있는 날만) 일별 총 업무 시간 − 그날 주요 합
              </p>
              {pieData.length === 0 ? (
                <p className="mt-6 text-sm text-[#94a3b8]">표시할 데이터가 없습니다.</p>
              ) : (
                <div className="mt-4 h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={88}
                        paddingAngle={2}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => [`${v} h`, '']}
                        contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)' }}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ul className="mt-2 space-y-1 text-sm text-[#64748b]">
                <li>
                  · 주요(기록): <strong className="text-[#1e293b]">{totalLoggedHours.toFixed(1)} h</strong>
                </li>
                <li>
                  · 미분류:{' '}
                  <strong className="text-[#1e293b]">
                    {loadingCaps ? '…' : unclassifiedSum.toFixed(1)} h
                  </strong>
                </li>
                <li>
                  · 일별 한도 합 (활동일만):{' '}
                  <strong className="text-[#1e293b]">
                    {loadingCaps ? '…' : capSum.toFixed(1)} h
                  </strong>
                  <span className="text-[#94a3b8]"> · 활동 인원일 {memberDatePairsWithLogs.length}건</span>
                </li>
              </ul>
            </div>
            <div className="section-card p-5 flex flex-col justify-center">
              <h3 className="text-base font-semibold text-[#1e293b]">지표 설명</h3>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#64748b]">
                <li>
                  <strong className="text-[#1e293b]">근로일수</strong>: 해당 월·연도 안에서{' '}
                  <strong>팀원 중 한 명이라도</strong> 소요시간·건수·업무내용 중 하나라도 있는(취소 제외) 실질 업무
                  기록이 있는 날짜를 하루씩 한 번만 센 값입니다. 연·반차만 적힌 날은 포함하지 않습니다(주말 기록은
                  포함).
                </li>
                <li>
                  <strong className="text-[#1e293b]">가동률</strong>: 총 기록 시간 ÷ (해당 기간 중{' '}
                  <strong>실질 업무가 있는 평일 수</strong> × 팀원 수 × 8h). 기록이 없는 평일은 분모에 넣지
                  않습니다.
                </li>
                <li>
                  <strong className="text-[#1e293b]">부하율</strong>: 총 기록 시간 ÷ (기록이 있는 날짜만 합산한)
                  팀원별·일별 &quot;총 업무 시간&quot; 합계.
                </li>
                <li>
                  <strong className="text-[#1e293b]">주요/미분류</strong>: 주요는 표 소요시간 합. 미분류는 같은 날
                  일한도에서 주요를 뺀 잔여를, 기록이 있는 날짜에 대해서만 합산합니다.
                </li>
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
