import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Settings, Database, AlertCircle, CheckCircle2 } from 'lucide-react';
import { dataService } from '@/services/DataService';
import { dbPathService } from '@/services/dbPathService';
import { DbPathSection } from '@/components/DbPathSection';
import { APP_VERSION } from '@/constants/appVersion';

interface SettingsDialogProps {
  trigger?: React.ReactNode;
}

/**
 * 환경 설정 다이얼로그
 * 
 * ⚠️ PostgreSQL 연결 설정은 Electron 환경에서만 동작합니다.
 * ⚠️ 웹 미리보기에서는 버튼이 비활성화됩니다.
 */
export function SettingsDialog({ trigger }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [dbPath, setDbPath] = useState<string>('');
  const [isElectron, setIsElectron] = useState(false);
  const config = dataService.getConfig();

  useEffect(() => {
    if (!open) return;
    const isElectronEnv = dbPathService.isElectronEnvironment();
    setIsElectron(isElectronEnv);

    const loadPath = async () => {
      if (isElectronEnv && dbPathService.getCurrentDbPathAsync) {
        const path = await dbPathService.getCurrentDbPathAsync();
        setDbPath(path || '');
      } else {
        setDbPath(dbPathService.getCurrentDbPath() || '');
      }
    };
    void loadPath();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            환경 설정
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 데이터베이스 정보 섹션 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-base font-medium">
              <Database className="h-4 w-4" />
              데이터베이스 설정
            </div>

            {/* 현재 어댑터 상태 (표시만, 연결 안 함) */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-base text-muted-foreground">저장소 타입</span>
                <span className="text-base font-medium flex items-center gap-1.5">
                  {config.adapterType === 'indexeddb' ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      In-Memory (웹)
                    </>
                  ) : config.adapterType === 'postgresql' ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      PostgreSQL
                    </>
                  ) : (
                    <>
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      SQLite (로컬)
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-base text-muted-foreground">연결 상태</span>
                <span className="text-base font-medium flex items-center gap-1.5">
                  {config.isConnected ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      연결됨
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      연결 안됨
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-base text-muted-foreground">연결 요약</span>
                <span className="text-base font-medium text-right max-w-[200px] truncate">
                  {isElectron && dbPath ? dbPath : '(설정 안됨)'}
                </span>
              </div>
            </div>

            <DbPathSection active={open} />
          </div>
        </div>
        <div className="pt-4 border-t border-border/50 mt-4 space-y-1 text-center">
          <p className="text-[10px] text-muted-foreground/80 tabular-nums tracking-wide">
            v{APP_VERSION}
          </p>
          <p className="text-xs text-muted-foreground">© 2026 kimgeonwoo</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
