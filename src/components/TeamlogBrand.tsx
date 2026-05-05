import { cn } from '@/lib/utils';

/** 작성 화면 사이드바와 동일한 좌측 상단 Teamlog 브랜드 */
export function TeamlogBrand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 mb-1 pl-1', className)}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="2" y="6" width="20" height="12" rx="3" stroke="#02a1c0" strokeWidth="2" />
        <path d="M8 10h8M8 14h4" stroke="#02a1c0" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="text-[20px] font-bold tracking-tight text-[#1e293b] leading-none">
        Team<span className="text-[#02a1c0]">log</span>
      </div>
    </div>
  );
}
