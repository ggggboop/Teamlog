import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PasswordInputWithToggleProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Input에 넘길 className (높이·테두리 등) */
  inputClassName?: string;
  autoComplete?: string;
  id?: string;
  disabled?: boolean;
}

export function PasswordInputWithToggle({
  value,
  onChange,
  placeholder,
  inputClassName,
  autoComplete,
  id,
  disabled,
}: PasswordInputWithToggleProps) {
  const [show, setShow] = useState(false);
  const uid = useId();
  const inputId = id ?? uid;

  return (
    <div className="relative w-full min-w-0">
      <Input
        id={inputId}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn('pr-10', inputClassName)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
      </Button>
    </div>
  );
}
