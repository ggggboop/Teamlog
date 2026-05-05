import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Database, FolderOpen, Info } from 'lucide-react';
import { dbPathService } from '@/services/dbPathService';
import { toast } from 'sonner';

interface DbPathSectionProps {
  /** true일 때(예: 설정 다이얼로그가 열릴 때) 경로를 다시 읽습니다. */
  active?: boolean;
}

export function DbPathSection({ active = true }: DbPathSectionProps) {
  const [dbPath, setDbPath] = useState<string>('');
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    if (!active) return;

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
  }, [active]);

  const handleSelectDbPath = async () => {
    if (!isElectron) {
      toast.error('DB 경로 변경은 Electron 앱에서만 가능합니다.');
      return;
    }

    try {
      const result = await dbPathService.selectDbPath();
      if (result) {
        setDbPath(result);
        toast.success('DB 경로가 변경되었습니다. 새 DB를 사용하려면 창을 새로고침합니다.');
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (error) {
      console.error('DB 경로 변경 실패:', error);
      toast.error('DB 경로 변경에 실패했습니다.');
    }
  };

  const handleCreateNewDb = async () => {
    if (!isElectron) {
      toast.error('새 DB 생성은 Electron 앱에서만 가능합니다.');
      return;
    }

    try {
      const result = await dbPathService.createNewDb();
      if (result) {
        setDbPath(result);
        toast.success('새 DB가 생성되었습니다. 새 DB를 사용하려면 창을 새로고침합니다.');
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (error) {
      console.error('새 DB 생성 실패:', error);
      toast.error('새 DB 생성에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Database className="h-4 w-4" />
        DB 파일 경로
      </div>
      <Label htmlFor="dbPath" className="text-sm text-muted-foreground sr-only">
        DB 파일 경로
      </Label>
      <div className="flex gap-2">
        <Input
          id="dbPath"
          value={isElectron ? dbPath : '웹 환경에서는 메모리 저장소를 사용합니다'}
          readOnly
          className="flex-1 text-sm"
          placeholder="DB 파일 경로"
        />
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={handleSelectDbPath}
          disabled={!isElectron}
          title={isElectron ? 'DB 파일 선택' : 'Electron 환경에서만 사용 가능'}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>

      {!isElectron && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          DB 경로 설정은 Electron 앱으로 내보낸 후 사용할 수 있습니다. 현재는 메모리에 데이터가 임시 저장됩니다 (새로고침 시
          초기화).
        </p>
      )}

      {isElectron && (
        <Button variant="outline" className="w-full" type="button" onClick={handleCreateNewDb}>
          <Database className="h-4 w-4 mr-2" />
          새 DB 파일 생성
        </Button>
      )}
    </div>
  );
}
