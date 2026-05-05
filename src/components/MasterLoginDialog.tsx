import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface MasterLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  verifyMasterLogin: (loginId: string, password: string) => Promise<boolean>;
  /** 팀 관리자 로그인에서 마스터로 인식된 경우 미리 채움 */
  initialLoginId?: string;
  initialPassword?: string;
}

export function MasterLoginDialog({
  open,
  onOpenChange,
  onSuccess,
  verifyMasterLogin,
  initialLoginId = '',
  initialPassword = '',
}: MasterLoginDialogProps) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoginId(initialLoginId);
      setPassword(initialPassword);
      setError('');
    }
  }, [open, initialLoginId, initialPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const ok = await verifyMasterLogin(loginId.trim(), password);
      if (ok) {
        setLoginId('');
        setPassword('');
        onOpenChange(false);
        onSuccess();
      } else {
        setError('ID 또는 비밀번호가 올바르지 않습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setError('');
          setPassword('');
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>마스터 로그인</DialogTitle>
          <DialogDescription>관리자 설정에 진입하려면 마스터 계정으로 로그인하세요.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">ID</label>
            <Input
              value={loginId}
              onChange={(e) => {
                setLoginId(e.target.value);
                setError('');
              }}
              className="mt-1"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">비밀번호</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              className="mt-1"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '확인 중…' : '다음'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
