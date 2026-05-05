import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface AdminPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  teamId: string;
  teamName?: string;
  verifyTeamAdmin: (teamId: string, loginId: string, password: string) => Promise<boolean>;
  verifyMasterLogin: (loginId: string, password: string) => Promise<boolean>;
  /** 마스터 계정으로 인식되면 호출 — 앱으로 진입(관리자 대시보드 + 마스터 메뉴) */
  onMasterSuccess: () => void;
}

export function AdminPasswordDialog({
  open,
  onOpenChange,
  onSuccess,
  teamId,
  teamName,
  verifyTeamAdmin,
  verifyMasterLogin,
  onMasterSuccess,
}: AdminPasswordDialogProps) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const lid = loginId.trim();
      const teamOk = await verifyTeamAdmin(teamId, lid, password);
      if (teamOk) {
        setLoginId('');
        setPassword('');
        // 성공 시 onOpenChange(false) 호출 금지: 부모가 팀/세션을 지우는 dismiss 핸들러와 연결되어 팀 선택 화면으로 튕김
        onSuccess();
        return;
      }
      if (await verifyMasterLogin(lid, password)) {
        setLoginId('');
        setPassword('');
        onMasterSuccess();
        return;
      }
      setError('관리자 ID 또는 비밀번호가 올바르지 않습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setPassword('');
      setLoginId('');
      setError('');
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>팀 관리자 로그인</DialogTitle>
          <DialogDescription>
            {teamName ? `「${teamName}」` : '선택한 팀'}의 팀 관리자 계정으로 로그인하세요. 마스터 계정이면 이 단계를 건너뛰고 바로
            입장합니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">관리자 ID</label>
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
            {loading ? '확인 중…' : '확인'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
