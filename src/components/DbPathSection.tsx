import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Database, Info, Loader2 } from 'lucide-react';
import { dbPathService } from '@/services/dbPathService';
import { toast } from 'sonner';

interface DbPathSectionProps {
  /** true일 때(예: 설정 다이얼로그가 열릴 때) 연결 요약·폼을 다시 읽습니다. */
  active?: boolean;
}

export function DbPathSection({ active = true }: DbPathSectionProps) {
  const [isElectron, setIsElectron] = useState(false);
  const [summary, setSummary] = useState<string>('');

  const [host, setHost] = useState('');
  const [port, setPort] = useState(5432);
  const [user, setUser] = useState('');
  const [database, setDatabase] = useState('');
  const [password, setPassword] = useState('');
  const [hasSavedPassword, setHasSavedPassword] = useState(false);

  const [busyTest, setBusyTest] = useState(false);
  const [busySave, setBusySave] = useState(false);

  useEffect(() => {
    if (!active) return;
    const electronEnv = dbPathService.isElectronEnvironment();
    setIsElectron(electronEnv);
    if (!electronEnv || !window.electron) return;

    void (async () => {
      try {
        const s = await window.electron!.getDbPath();
        setSummary(s ?? '');
        const ui = await window.electron!.pgGetSettingsForUi();
        setHost(ui.host);
        setPort(ui.port);
        setUser(ui.user);
        setDatabase(ui.database);
        setHasSavedPassword(ui.hasPassword);
      } catch {
        setSummary('');
      }
    })();
  }, [active]);

  const runTest = async () => {
    if (!window.electron?.pgTestConnection) return;
    setBusyTest(true);
    try {
      const res = await window.electron.pgTestConnection({
        host,
        port: Number(port),
        user,
        database,
        password: password.trim() || undefined,
      });
      if (res.ok) {
        toast.success('PostgreSQL 연결에 성공했습니다.');
      } else {
        toast.error(res.errorMessage);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || '연결 확인에 실패했습니다.');
    } finally {
      setBusyTest(false);
    }
  };

  const runSave = async () => {
    if (!window.electron?.pgSaveAndReinit) return;
    if (!(host.trim() && database.trim())) {
      toast.error('호스트와 데이터베이스 이름은 필수입니다.');
      return;
    }
    setBusySave(true);
    try {
      const res = await window.electron.pgSaveAndReinit({
        host: host.trim(),
        port: Number(port),
        user: user.trim(),
        database: database.trim(),
        password: password.trim(),
      });
      if (res.ok) {
        toast.success('설정을 저장하고 데이터베이스에 다시 연결했습니다.');
        setPassword('');
        const s = await window.electron.getDbPath();
        setSummary(s ?? '');
        const ui = await window.electron.pgGetSettingsForUi();
        setHasSavedPassword(ui.hasPassword);
        window.location.reload();
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || '저장에 실패했습니다.');
    } finally {
      setBusySave(false);
    }
  };

  if (!isElectron) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4" />
          PostgreSQL 연결
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          연결 설정은 Electron 데스크톱 앱에서만 구성할 수 있습니다. 웹 미리보기는 메모리 저장소를 사용합니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Database className="h-4 w-4" />
        PostgreSQL 연결
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">현재 요약</Label>
        <Input value={summary || '(연결 정보 없음)'} readOnly className="mt-1 text-sm" />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        아래는 <strong>PostgreSQL 서버</strong> 접속 정보입니다. 앱 로그인용 마스터 사번·비밀번호와는 별개입니다.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="pg-host" className="text-xs">
            호스트
          </Label>
          <Input id="pg-host" value={host} onChange={(e) => setHost(e.target.value)} className="text-sm" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pg-port" className="text-xs">
            포트
          </Label>
          <Input
            id="pg-port"
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pg-user" className="text-xs">
            DB 사용자
          </Label>
          <Input id="pg-user" value={user} onChange={(e) => setUser(e.target.value)} className="text-sm" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="pg-db" className="text-xs">
            데이터베이스
          </Label>
          <Input id="pg-db" value={database} onChange={(e) => setDatabase(e.target.value)} className="text-sm" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="pg-password" className="text-xs">
            DB 비밀번호 {hasSavedPassword ? '(비워 두면 기존 값 유지)' : ''}
          </Label>
          <Input
            id="pg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="text-sm"
            autoComplete="new-password"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="flex-1" disabled={busyTest} onClick={() => void runTest()}>
          {busyTest ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          연결 테스트
        </Button>
        <Button type="button" className="flex-1" disabled={busySave} onClick={() => void runSave()}>
          {busySave ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          저장 후 재연결
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        저장 시 DB 비밀번호는 settings.json에 Base64(b64:) 형태로만 기록됩니다.
      </p>
    </div>
  );
}
