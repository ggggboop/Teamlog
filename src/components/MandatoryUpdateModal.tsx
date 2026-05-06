import { APP_VERSION } from '@/constants/appVersion';

export interface MandatoryUpdateModalProps {
  currentVersion: string;
  minRequiredVersion: string;
}

/**
 * 필수 업데이트 시 전체 화면 차단 오버레이 (닫기 없음)
 */
export function MandatoryUpdateModal({ currentVersion, minRequiredVersion }: MandatoryUpdateModalProps) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mandatory-update-title"
      aria-describedby="mandatory-update-desc"
      style={{ pointerEvents: 'all' }}
    >
      <div className="absolute inset-0 bg-background/92 backdrop-blur-[2px]" aria-hidden />
      <div className="relative z-[1] w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-xl text-center space-y-4">
        <h1 id="mandatory-update-title" className="text-lg font-semibold text-foreground">
          필수 업데이트
        </h1>
        <p id="mandatory-update-desc" className="text-sm text-muted-foreground leading-relaxed">
          보안 및 데이터 안정성을 위해 필수 업데이트가 필요합니다. 현재 버전:{' '}
          <span className="font-mono font-medium text-foreground">{currentVersion}</span>, 권장 버전:{' '}
          <span className="font-mono font-medium text-foreground">{minRequiredVersion}</span> 이상
        </p>
        <p className="text-xs text-muted-foreground">
          관리자에게 최신 설치 프로그램을 받은 뒤 이 앱을 종료하고 다시 설치해 주세요. 이 창은 닫을 수 없습니다.
        </p>
        <p className="text-[11px] text-muted-foreground/80 pt-2 border-t border-border">
          패키지 표시 버전(UI): {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
