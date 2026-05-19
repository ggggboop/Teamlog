/**
 * userData/settings.json 의 PostgreSQL 설정 읽기/쓰기.
 * 비밀번호는 평문 저장을 피하기 위해 Base64(b64: 접두)로 저장합니다.
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { Pool, type PoolClient } from 'pg';
import { hashTeamlogPassword } from './pgAuthUtils';

export interface PgConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const B64_PREFIX = 'b64:';

export interface TeamlogSettingsFile {
  dbPath?: string;
  pg?: Partial<PgConnectionConfig & { password?: string }>;
}

export function getTeamlogSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** 파일에 저장할 때(UTF-8 평문 → Base64 표시) */
export function encodePgPasswordForStorage(plain: string): string {
  if (plain === '') return '';
  return B64_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
}

/** 파일에서 읽은 값 → 연결용 평문 */
export function decodePgPasswordFromStorage(stored: string | undefined): string {
  if (stored == null || stored === '') return '';
  if (stored.startsWith(B64_PREFIX)) {
    try {
      return Buffer.from(stored.slice(B64_PREFIX.length), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  return stored;
}

export function readTeamlogSettings(): TeamlogSettingsFile {
  try {
    const p = getTeamlogSettingsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as TeamlogSettingsFile;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function writeTeamlogSettingsFile(next: TeamlogSettingsFile): void {
  const p = getTeamlogSettingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
}

/** pg만 병합 저장(나머지 키 유지). password는 평문으로 받아 저장 시 인코딩. 빈 문자열이면 기존 파일 비밀번호 유지 */
export function mergeSavePgToSettings(pg: PgConnectionConfig): void {
  const cur = readTeamlogSettings();
  const prevStoredPwd = cur.pg?.password;
  let passwordStored: string;
  if (pg.password !== '') {
    passwordStored = encodePgPasswordForStorage(pg.password);
  } else if (prevStoredPwd !== undefined && String(prevStoredPwd).trim() !== '') {
    passwordStored = String(prevStoredPwd);
  } else {
    passwordStored = '';
  }
  cur.pg = {
    host: pg.host,
    port: pg.port,
    user: pg.user,
    database: pg.database,
    password: passwordStored,
  };
  writeTeamlogSettingsFile(cur);
}

export function isPgSettingsEmptyInFile(): boolean {
  const pg = readTeamlogSettings().pg;
  if (!pg) return true;
  const host = (pg.host ?? '').trim();
  const database = (pg.database ?? '').trim();
  return !host || !database;
}

function tryLoadDotEnv(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore */
  }
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function mergePgConnectionFromDiskAndEnv(): PgConnectionConfig {
  tryLoadDotEnv(path.join(app.getAppPath(), '.env'));
  tryLoadDotEnv(path.join(process.cwd(), '.env'));

  const fromEnv: Partial<PgConnectionConfig> = {
    host: process.env.PGHOST || process.env.PG_HOST,
    port: parsePort(process.env.PGPORT || process.env.PG_PORT),
    user: process.env.PGUSER || process.env.PG_USER,
    password: process.env.PGPASSWORD ?? process.env.PG_PASSWORD ?? '',
    database: process.env.PGDATABASE || process.env.PG_DATABASE,
  };

  const saved = readTeamlogSettings().pg ?? {};
  const decodedPassword = decodePgPasswordFromStorage(
    saved.password !== undefined ? String(saved.password) : undefined
  );

  return {
    host: saved.host || fromEnv.host || '10.10.21.29',
    port: saved.port ?? fromEnv.port ?? 5433,
    user: saved.user || fromEnv.user || 'postgres',
    password: decodedPassword !== '' ? decodedPassword : (fromEnv.password || 'team1234'),
    database: saved.database || fromEnv.database || 'teamlog',
  };
}

/** UI용: 비밀번호 미포함 */
export function getPgSettingsForUi(): {
  host: string;
  port: number;
  user: string;
  database: string;
  hasPassword: boolean;
} {
  const s = readTeamlogSettings().pg ?? {};
  const merged = mergePgConnectionFromDiskAndEnv();
  const rawPwd = s.password !== undefined ? String(s.password) : '';
  const hasFilePassword = rawPwd.length > 0;
  const hasEnvPassword = !!(process.env.PGPASSWORD || process.env.PG_PASSWORD);
  return {
    host: (s.host ?? merged.host) || '10.10.21.29',
    port: s.port ?? merged.port ?? 5433,
    user: (s.user ?? merged.user) || 'postgres',
    database: (s.database ?? merged.database) || 'teamlog',
    hasPassword: hasFilePassword || hasEnvPassword || true,
  };
}

type PgQueryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** DB에 마스터 행이 있으면 사번·비밀번호 검증 */
export async function verifyMasterCredentialsOnPool(
  exec: PgQueryable,
  loginId: string,
  password: string
): Promise<boolean> {
  const id = (loginId ?? '').trim();
  const idRow = await exec.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
    'master_login_id',
  ]);
  if (!idRow.rows[0] || idRow.rows[0].value !== id) return false;
  const pw = (password ?? '').trim();
  if (pw === '') return true;
  const pwRow = await exec.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
    'master_password_hash',
  ]);
  if (!pwRow.rows[0]) return false;
  return pwRow.rows[0].value === hashTeamlogPassword(password);
}

/** 마스터 설정 행 존재 여부(없으면 초기 구성으로 간주) */
export async function hasMasterRowInPool(exec: PgQueryable): Promise<boolean> {
  const r = await exec.query('SELECT 1 FROM app_settings WHERE key = $1 LIMIT 1', ['master_login_id']);
  return (r.rowCount ?? 0) > 0;
}

export function formatPgConnectionError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return err instanceof Error ? err.message : String(err);
  }
  const e = err as NodeJS.ErrnoException & { code?: string; message?: string };
  const code = e.code;
  const msg = (e.message ?? '').toLowerCase();

  if (code === 'ECONNREFUSED' || msg.includes('econnrefused')) {
    return '서버에 연결할 수 없습니다. IP 주소와 포트를 확인하세요.';
  }
  if (code === 'ETIMEDOUT' || msg.includes('timeout')) {
    return '연결 시간이 초과되었습니다. 방화벽과 네트워크를 확인하세요.';
  }
  if (code === 'ENOTFOUND' || msg.includes('getaddrinfo')) {
    return '호스트 이름을 찾을 수 없습니다. IP 또는 호스트 주소를 확인하세요.';
  }
  if (code === '28P01' || msg.includes('password authentication failed')) {
    return 'PostgreSQL 인증에 실패했습니다. 사용자 이름과 비밀번호를 확인하세요.';
  }
  if (code === '3D000' || msg.includes('database') && msg.includes('does not exist')) {
    return '데이터베이스가 존재하지 않습니다. DB 이름을 확인하세요.';
  }
  return e.message || 'PostgreSQL 연결에 실패했습니다.';
}

const TEST_POOL_CONNECT_MS = 5000;

export async function testPgConnectionRaw(
  config: PgConnectionConfig
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 1,
    connectionTimeoutMillis: TEST_POOL_CONNECT_MS,
    idleTimeoutMillis: 100,
  });
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (e) {
    return { ok: false, errorMessage: formatPgConnectionError(e) };
  } finally {
    await pool.end().catch(() => {});
  }
}
