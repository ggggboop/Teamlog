import type { EffortIqrTier } from '@/utils/effortCalculation';

export function tierBadgeClass(t: EffortIqrTier): string {
  switch (t) {
    case 'severe':
      return 'bg-red-100 text-red-900 border-red-200';
    case 'caution':
      return 'bg-amber-100 text-amber-950 border-amber-200';
    case 'normal':
      return 'bg-emerald-50 text-emerald-900 border-emerald-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function tierShortKo(t: EffortIqrTier): string {
  switch (t) {
    case 'severe':
      return '이상';
    case 'caution':
      return '주의';
    case 'normal':
      return '정상';
    default:
      return '집계중';
  }
}

/** 공수 계산·업무 분류 통계에서 동일: IQR 상단 꼬리 판정 표시 */
export function EffortIqrSignal({ tier }: { tier: EffortIqrTier }) {
  switch (tier) {
    case 'collecting':
      return (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="유닛 5건 미만">
          집계중
        </span>
      );
    case 'normal':
      return (
        <span className="inline-flex items-center gap-1 text-emerald-800 whitespace-nowrap" title="정상">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-[11px]">정상</span>
        </span>
      );
    case 'caution':
      return (
        <span className="inline-flex items-center gap-1 text-amber-900 whitespace-nowrap" title="주의">
          <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
          <span className="text-[11px]">주의</span>
        </span>
      );
    case 'severe':
      return (
        <span className="inline-flex items-center gap-1 text-red-900 whitespace-nowrap" title="이상">
          <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
          <span className="text-[11px]">이상</span>
        </span>
      );
  }
}
