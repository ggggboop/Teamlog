import type { FormEvent } from 'react';
import { Users, ShieldCheck, LogIn } from 'lucide-react';
import { DbPathSection } from '@/components/DbPathSection';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface LoginFormPanelProps {
  loading: boolean;
  busy: boolean;
  employeeNo: string;
  password: string;
  adminPhase: 'idle' | 'need_password';
  onEmployeeNoChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  className?: string;
  /** split: 원소 타일 느낌 · embedded: 상위 팝업 셸 안에 넣을 때(카드 중복 없음) */
  variant?: 'default' | 'split' | 'embedded';
}

export function LoginFormPanel({
  loading,
  busy,
  employeeNo,
  password,
  adminPhase,
  onEmployeeNoChange,
  onPasswordChange,
  onSubmit,
  className,
  variant = 'default',
}: LoginFormPanelProps) {
  const split = variant === 'split';
  const embedded = variant === 'embedded';

  return (
    <div
      className={cn(
        embedded
          ? 'w-full space-y-6'
          : 'sl-glass-card p-8 space-y-8 w-full max-w-md shadow-none border border-white/90',
        !embedded &&
          split &&
          'rounded-[28px] border-white/95 bg-white/90 shadow-[inset_2px_2px_4px_rgba(255,255,255,1),inset_-2px_-4px_8px_rgba(0,0,0,0.02),0_4px_8px_rgba(0,0,0,0.04),16px_24px_36px_-8px_rgba(20,35,70,0.1)]',
        className
      )}
    >
      {!embedded && (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
              split && 'rounded-[22px]'
            )}
            style={{
              background: 'linear-gradient(135deg, var(--sl-blue-light, #4892fc), var(--sl-blue-main, #2d7df6))',
              boxShadow: split
                ? 'inset 2px 2px 6px rgba(255,255,255,0.35), 0 8px 20px rgba(45,125,246,0.35)'
                : '0 8px 24px rgba(45, 125, 246, 0.35)',
            }}
          >
            <Users className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--sl-text-main, #334155)' }}>
              업무 기록
            </h2>
          </div>
        </div>
      )}

      {!embedded && <DbPathSection />}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="employeeNo">사번</Label>
          <Input
            id="employeeNo"
            value={employeeNo}
            onChange={(ev) => onEmployeeNoChange(ev.target.value)}
            placeholder="사번 입력"
            autoComplete="username"
            disabled={loading || busy}
            className="font-mono"
          />
        </div>

        {adminPhase === 'need_password' && (
          <div className="space-y-2 animate-in fade-in duration-300">
            <Label htmlFor="adminPassword" className="flex items-center gap-2">
              <ShieldCheck
                className="h-4 w-4"
                style={{ color: embedded ? '#02a1c0' : 'var(--sl-blue-main, #2d7df6)' }}
              />
              관리자 비밀번호
            </Label>
            <Input
              id="adminPassword"
              type="password"
              value={password}
              onChange={(ev) => onPasswordChange(ev.target.value)}
              placeholder="비밀번호"
              autoComplete="current-password"
              disabled={loading || busy}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading || busy}
          className={cn(
            embedded
              ? 'inline-flex w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02a1c0] px-4 py-3 text-base font-semibold text-white shadow-[0_8px_24px_rgba(2,161,192,0.35)] transition hover:bg-[#029cb8] hover:shadow-[0_10px_28px_rgba(2,161,192,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02a1c0] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
              : 'sl-login-primary-btn'
          )}
        >
          <span className="inline-flex items-center justify-center gap-2">
            <LogIn className="h-4 w-4" />
            {adminPhase === 'need_password' ? '입장' : '다음'}
          </span>
        </button>
      </form>

      {!embedded && (
        <p className="text-xs text-center" style={{ color: 'var(--sl-text-muted, #94a3b8)' }}>
          일반 팀원은 사번만으로 작성 화면으로 이동합니다. Manager, Director, Master는 비밀번호가 필요합니다.
        </p>
      )}
    </div>
  );
}
