/**
 * Electron IPC / SQLite 등에서 올라온 원문 오류를 사용자에게 보여줄 짧은 안내 문구로 바꿉니다.
 */
export function formatFriendlyDataError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes('locking protocol') ||
    (lower.includes('sqlite') && lower.includes('protocol'))
  ) {
    return '데이터 파일 잠금 오류입니다. Teamlog 창을 하나만 사용하고, 같은 DB를 다른 PC·프로그램에서 열고 있지 않은지 확인한 뒤 잠시 후 다시 시도해 주세요. (공유 폴더에는 네트워크 지연으로 자주 발생할 수 있습니다.)';
  }

  if (lower.includes('database is locked') || lower.includes('sqlite_busy') || lower.includes('busy')) {
    return '데이터베이스가 잠시 사용 중입니다. 다른 작업이 끝난 뒤 다시 시도해 주세요.';
  }

  if (lower.includes('unable to open database file') || lower.includes('disk i/o error')) {
    return '데이터 파일을 열 수 없습니다. 저장 경로·USB·네트워크 연결과 백신/동기화 프로그램을 확인해 주세요.';
  }

  if (lower.includes('electron api not available')) {
    return '이 기능은 앱(Electron) 실행 환경에서만 사용할 수 있습니다.';
  }

  if (lower.includes('corrupt') || lower.includes('malformed')) {
    return '데이터 파일이 손상되었거나 형식이 맞지 않을 수 있습니다. 백업 복구 또는 관리자에게 문의해 주세요.';
  }

  if (lower.includes('unique constraint') || lower.includes('constraint failed')) {
    return '이미 존재하는 값이거나 규칙에 맞지 않아 저장할 수 없습니다.';
  }

  if (lower.includes('foreign key')) {
    return '연결된 다른 데이터가 있어 처리할 수 없습니다.';
  }

  if (lower.includes('invocation failed') || lower.includes('error invoking remote method')) {
    return '앱과 통신하는 중 오류가 났습니다. 창을 다시 열거나 재시도해 주세요.';
  }

  if (raw.length > 200) {
    return `${raw.slice(0, 197)}…`;
  }

  return raw;
}
