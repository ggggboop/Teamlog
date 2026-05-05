import { useMemo } from 'react';
import { TeamMember, WorkLog, type WorkIndicatorType } from '@/types/workLog';
import { format, startOfMonth, endOfMonth, getDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { addDurations, finalizeDurationSum } from '@/utils/workLogNumeric';
interface PrintableReportProps {
  members: TeamMember[];
  logs: WorkLog[];
  categories: string[];
  currentDate: Date;
  onClose: () => void;
}

export function PrintableReport({ members, logs, categories, currentDate, onClose }: PrintableReportProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  const stats = useMemo(() => {
    const safeCategories = categories || [];
    
    const monthLogs = logs.filter(
      (l) =>
        l.date >= format(monthStart, 'yyyy-MM-dd') &&
        l.date <= format(monthEnd, 'yyyy-MM-dd') &&
        l.status !== '취소'
    );

    const totalHours = monthLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
    const totalTasks = monthLogs.length;
    const totalCount = monthLogs.reduce((sum, l) => sum + l.count, 0);
    const avgDuration = totalTasks > 0 ? finalizeDurationSum(totalHours / totalTasks) : 0;

    const workIndicatorStats: Record<WorkIndicatorType, number> = {
      'R&R/루틴업무': 0,
      '현안대응': 0,
      '품질고도화 과제': 0,
      '조직운영관리': 0,
      '기타/행정': 0,
    };
    monthLogs.forEach((l) => {
      workIndicatorStats[l.workIndicator] += l.count;
    });

    // 업무분류별 상세 통계
    const categoryDetailStats = safeCategories.map((cat) => {
      const catLogs = monthLogs.filter((l) => l.category === cat);
      const catHours = catLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const catCount = catLogs.reduce((sum, l) => sum + l.count, 0);
      const workIndicator: Record<WorkIndicatorType, number> = {
        'R&R/루틴업무': 0,
        '현안대응': 0,
        '품질고도화 과제': 0,
        '조직운영관리': 0,
        '기타/행정': 0,
      };
      catLogs.forEach((l) => {
        workIndicator[l.workIndicator] += l.count;
      });
      return {
        category: cat,
        taskCount: catLogs.length,
        totalCount: catCount,
        hours: catHours,
        workIndicator,
      };
    }).filter(s => s.taskCount > 0).sort((a, b) => b.hours - a.hours);

    // 요일별 통계
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dailyStats = dayNames.map((name, idx) => {
      const dayLogs = monthLogs.filter(l => getDay(new Date(l.date)) === idx);
      return {
        day: name,
        count: dayLogs.length,
        hours: dayLogs.reduce((sum, l) => addDurations(sum, l.duration), 0),
      };
    });

    // 팀원별 통계
    const memberStats = members.map((member) => {
      const memberLogs = monthLogs.filter((l) => l.memberId === member.id);
      const memberHours = memberLogs.reduce((sum, l) => addDurations(sum, l.duration), 0);
      const memberTasks = memberLogs.length;
      const memberCount = memberLogs.reduce((sum, l) => sum + l.count, 0);
      const workIndicatorCounts: Record<WorkIndicatorType, number> = {
        'R&R/루틴업무': 0,
        '현안대응': 0,
        '품질고도화 과제': 0,
        '조직운영관리': 0,
        '기타/행정': 0,
      };
      memberLogs.forEach((l) => {
        workIndicatorCounts[l.workIndicator] += l.count;
      });
      return {
        member,
        hours: memberHours,
        taskCount: memberTasks,
        totalCount: memberCount,
        workIndicatorCounts,
      };
    }).sort((a, b) => b.hours - a.hours);

    return {
      totalHours,
      totalTasks,
      totalCount,
      avgDuration,
      workIndicatorStats,
      categoryDetailStats,
      dailyStats,
      memberStats,
    };
  }, [logs, members, categories, monthStart, monthEnd]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto print:relative print:inset-auto print:z-auto">
      {/* 인쇄 숨김 영역 - 컨트롤 버튼 */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">보고서 미리보기</h2>
          <p className="text-base text-gray-500">인쇄 또는 PDF로 저장하세요</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            닫기
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 text-base font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors"
          >
            인쇄하기
          </button>
        </div>
      </div>

      {/* 인쇄 영역 */}
      <div className="max-w-[210mm] mx-auto p-8 print:p-0 print:max-w-none">
        {/* 보고서 헤더 */}
        <header className="mb-8 pb-6 border-b-2 border-gray-900">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Monthly Work Report</p>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                {format(currentDate, 'yyyy년 M월', { locale: ko })} 업무 현황 보고서
              </h1>
            </div>
            <div className="text-right">
              <p className="text-base text-gray-500">생성일: {format(new Date(), 'yyyy.MM.dd', { locale: ko })}</p>
              <p className="text-base text-gray-500">
                팀원 {members.length}명 · 업무 {stats.totalCount}건
              </p>
            </div>
          </div>
        </header>

        {/* 핵심 지표 요약 */}
        <section className="mb-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Executive Summary</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">총 업무시간</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalHours.toFixed(1)}<span className="text-lg font-medium text-gray-400 ml-1">h</span></p>
            </div>
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">총 업무건수</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalCount}<span className="text-lg font-medium text-gray-400 ml-1">건</span></p>
            </div>
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 col-span-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">업무 지표 분류</p>
              <div className="flex flex-wrap gap-3 mt-2">
                {(['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'] as const).map((w) => (
                  <span key={w} className="text-base"><span className="font-bold text-gray-900">{(stats.workIndicatorStats || {})[w] || 0}</span><span className="text-gray-500 ml-1">건 {w}</span></span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 1순위: 업무분류별 소요시간 및 건수 */}
        <section className="mb-8 page-break-inside-avoid">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">업무분류별 현황</h2>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-base">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-600">업무분류</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600">소요시간</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600" title="각 행 건수 합계">
                    업무건수
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600">비중</th>
                </tr>
              </thead>
              <tbody>
                {stats.categoryDetailStats.map(({ category, totalCount, hours }, idx) => {
                  const percentage = stats.totalHours > 0 ? (hours / stats.totalHours) * 100 : 0;
                  return (
                    <tr key={category} className={cn("border-b border-gray-100", idx % 2 === 0 ? "bg-white" : "bg-gray-50/50")}>
                      <td className="py-3 px-4 font-medium text-gray-900">{category}</td>
                      <td className="text-right py-3 px-4 font-semibold text-primary">{hours.toFixed(1)}h</td>
                      <td className="text-right py-3 px-4 text-gray-700">{totalCount}건</td>
                      <td className="text-right py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                          <span className="text-gray-600 w-10 text-right">{percentage.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="py-3 px-4 text-gray-700">합계</td>
                  <td className="text-right py-3 px-4 text-primary">{stats.totalHours.toFixed(1)}h</td>
                  <td className="text-right py-3 px-4 text-gray-700">{stats.totalCount}건</td>
                  <td className="text-right py-3 px-4 text-gray-700">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* 2순위: 분류별 업무 지표 */}
        <section className="mb-8 page-break-inside-avoid">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">분류별 업무 지표 분석</h2>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-3 font-semibold text-gray-600">업무분류</th>
                  <th className="py-2 px-2 text-center font-semibold text-gray-600">R&R/루틴</th>
                  <th className="py-2 px-2 text-center font-semibold text-gray-600">현안대응</th>
                  <th className="py-2 px-2 text-center font-semibold text-gray-600">품질고도화</th>
                  <th className="py-2 px-2 text-center font-semibold text-gray-600">조직운영</th>
                  <th className="py-2 px-2 text-center font-semibold text-gray-600">기타/행정</th>
                </tr>
              </thead>
              <tbody>
                {stats.categoryDetailStats.map(({ category, workIndicator }, idx) => (
                  <tr key={category} className={cn("border-b border-gray-100", idx % 2 === 0 ? "bg-white" : "bg-gray-50/50")}>
                    <td className="py-2.5 px-3 font-medium text-gray-900">{category}</td>
                    {(['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'] as const).map((w) => (
                      <td key={w} className="text-center py-2.5 px-2">
                        {(workIndicator?.[w] || 0) > 0 ? <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-primary/15 text-primary font-semibold">{workIndicator[w]}</span> : <span className="text-gray-300">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold text-gray-700">
                  <td className="py-2.5 px-3">합계</td>
                  {(['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'] as const).map((w) => (
                    <td key={w} className="text-center py-2.5 px-2">{stats.workIndicatorStats?.[w] || 0}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* 팀원별 현황 & 요일별 분포 */}
        <section className="grid grid-cols-2 gap-6 mb-8 page-break-inside-avoid">
          {/* 팀원별 현황 */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">팀원별 현황</h2>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-base">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-2.5 px-3 font-semibold text-gray-600">팀원</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-gray-600">시간</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-gray-600">작성건수</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-gray-600">업무건수</th>
                    <th className="text-right py-2.5 px-3 font-semibold text-gray-600">업무지표</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.memberStats.map(({ member, hours, taskCount, totalCount: memberItemCount, workIndicatorCounts: wic }, idx) => (
                    <tr key={member.id} className={cn("border-b border-gray-100", idx % 2 === 0 ? "bg-white" : "bg-gray-50/50")}>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-gray-900">{member.name}</div>
                        <div className="text-xs text-gray-400">{member.role}</div>
                      </td>
                      <td className="text-right py-2.5 px-3 font-semibold text-primary">{hours.toFixed(1)}h</td>
                      <td className="text-right py-2.5 px-3 text-gray-700">{taskCount}건</td>
                      <td className="text-right py-2.5 px-3 text-gray-700">{memberItemCount}건</td>
                      <td className="text-right py-2.5 px-3 text-xs text-gray-600">
                        {wic && ['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'].map((w) => (wic[w] || 0) > 0 && `${w}${wic[w]}`).filter(Boolean).join(' ') || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 요일별 분포 */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">요일별 업무 분포</h2>
            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
              <div className="flex items-end justify-between gap-2 h-32">
                {stats.dailyStats.map(({ day, count, hours }) => {
                  const maxHours = Math.max(...stats.dailyStats.map(d => d.hours));
                  const percentage = maxHours > 0 ? (hours / maxHours) * 100 : 0;
                  const isWeekend = day === '토' || day === '일';
                  return (
                    <div key={day} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs font-semibold text-gray-700">{hours.toFixed(1)}h</span>
                      <div
                        className={cn(
                          "w-full rounded-t-lg transition-all",
                          isWeekend ? "bg-gray-300" : "bg-primary"
                        )}
                        style={{ height: `${Math.max(percentage * 0.8, 4)}px` }}
                      />
                      <span className={cn("text-base font-bold", isWeekend ? "text-gray-400" : "text-gray-700")}>{day}</span>
                      <span className="text-xs text-gray-400">{count}건</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 푸터 */}
        <footer className="mt-12 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            이 보고서는 {format(new Date(), 'yyyy년 M월 d일 HH:mm', { locale: ko })}에 생성되었습니다.
          </p>
          <p className="text-xs text-gray-400 mt-1">Team Worklog System</p>
        </footer>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 15mm;
          }
          
          html, body {
            height: auto !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          /* 컨테이너 인쇄 설정 */
          .fixed {
            position: static !important;
            overflow: visible !important;
            height: auto !important;
          }
          
          /* 페이지 나눔 설정 */
          section {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          table {
            page-break-inside: auto;
          }
          
          tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          thead {
            display: table-header-group;
          }
          
          tfoot {
            display: table-footer-group;
          }
          
          .page-break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          /* 배경색 보존 */
          .bg-gray-50, .bg-gray-100, .bg-primary\\/15, .bg-red-100, .bg-orange-100, .bg-yellow-100, .bg-green-100 {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          
          /* 푸터가 마지막에 오도록 */
          footer {
            page-break-before: avoid;
          }
        }
      `}</style>
    </div>
  );
}
