/**
 * ElectronDatabaseAdapter — Electron 메인 프로세스 전용 PostgreSQL 어댑터 (node-pg Pool)
 *
 * 연결 정보: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (또는 PG_* 별칭) 및
 * userData/settings.json 의 `pg` 객체. settings.json 값이 있으면 해당 키로 환경 변수를 덮어씁니다.
 */

import { Pool, type PoolClient } from 'pg';
import crypto from 'crypto';
import { TeamMember, WorkLog, Category, WorkTeam } from '../../src/types/workLog';
import { generateSampleData } from '../../src/data/sampleData';
import { QA_CATEGORIES_FLAT } from '../../src/data/qaCategories';
import { DEFAULT_TEAMS_SEED, TEAM_QG2_ID } from '../../src/data/teams';
import { GLOBAL_TEAM_ADMIN_SCOPE_ID } from '../../src/constants/globalTeamAdmin';
import type { GlobalTeamAdminSavePayload } from '../../src/constants/globalTeamAdmin';
import type { ChangeAdminPasswordSelfParams } from '../../src/constants/adminPasswordChange';
import {
  mergeAdminExtrasOnSave,
  parseStoredAdminExtras,
  serializeAdminExtras,
  toPreviewExtras,
} from '../../src/utils/adminExtraAccounts';
import { shouldPreserveImportedTeamAdmin } from '../../src/utils/preserveTeamAdminOnImport';
import type { SaveLogsBatchPayload } from '../../src/services/DatabaseAdapter';
import type { DatabaseConfig } from '../../src/services/DatabaseAdapter';
import {
  clampCountForImport,
  clampDurationForImport,
  normalizeCountForStorage,
  normalizeDurationForStorage,
} from '../../src/utils/workLogNumeric';
import { hashTeamlogPassword } from './pgAuthUtils';
import {
  mergePgConnectionFromDiskAndEnv,
  formatPgConnectionError,
  testPgConnectionRaw,
  type PgConnectionConfig,
} from './pgSettingsStorage';

export type { PgConnectionConfig } from './pgSettingsStorage';

type SqlExecutor = Pool | PoolClient;

function ensureDateYYYYMMDD(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return value.slice(0, 10);
}

/** IPC/UI 표시용 (비밀번호 제외) */
export function getPgConnectionSummary(): string {
  const c = mergePgConnectionFromDiskAndEnv();
  return `${c.user}@${c.host}:${c.port}/${c.database}`;
}

/** 최종 PostgreSQL 스키마 (SQLite 마이그레이션은 앱 내 export/import 로 이행) */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_login_id TEXT,
    admin_password_hash TEXT,
    admin_extra_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_teams_sort ON teams(sort_order);

CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT,
    status_message TEXT,
    employee_no TEXT,
    team_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    issues TEXT,
    duration DOUBLE PRECISION NOT NULL CHECK (duration >= 0),
    count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
    status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
    work_indicator TEXT NOT NULL DEFAULT '기타/행정' CHECK (work_indicator IN ('R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정')),
    task_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_work_logs_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date);
CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date);
CREATE INDEX IF NOT EXISTS idx_members_team_id ON members(team_id);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    record_id TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at ON audit_logs(changed_at);

CREATE OR REPLACE FUNCTION log_audit_trail() RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_logs (table_name, operation, record_id, old_data)
        VALUES (TG_TABLE_NAME, TG_OP, OLD.id::text, row_to_json(OLD)::jsonb);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (row_to_json(OLD)::jsonb = row_to_json(NEW)::jsonb) THEN
            RETURN NEW;
        END IF;
        INSERT INTO audit_logs (table_name, operation, record_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id::text, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_logs (table_name, operation, record_id, new_data)
        VALUES (TG_TABLE_NAME, TG_OP, NEW.id::text, row_to_json(NEW)::jsonb);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_db_change() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('db_changed', TG_TABLE_NAME);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
`;

function mapRowToWorkLog(r: Record<string, unknown>): WorkLog {
  const d = r.date;
  const dateStr = d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '');
  const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));
  return {
    id: String(r.id),
    memberId: String(r.memberId),
    date: dateStr,
    category: String(r.category),
    content: String(r.content),
    issues: r.issues == null ? undefined : String(r.issues),
    duration: Number(r.duration),
    count: Number(r.count),
    status: r.status as WorkLog['status'],
    workIndicator: r.workIndicator as WorkLog['workIndicator'],
    taskCode: r.taskCode == null || r.taskCode === '' ? undefined : String(r.taskCode),
    createdAt: ts(r.createdAt),
    updatedAt: ts(r.updatedAt),
  };
}

const WORK_LOG_SELECT = `
      SELECT w.id,
             w.member_id AS "memberId",
             w.date::text AS date,
             w.category,
             w.content,
             w.issues,
             w.duration,
             w.count,
             w.status,
             w.work_indicator AS "workIndicator",
             w.task_code AS "taskCode",
             w.created_at AS "createdAt",
             w.updated_at AS "updatedAt"
`;

export class ElectronDatabaseAdapter {
  private pool: Pool | null = null;
  private pgConfig: PgConnectionConfig | null = null;
  private config: DatabaseConfig;
  private listenerClient: PoolClient | null = null;
  private changeListeners: Array<(payload: string) => void> = [];

  private static readonly WRITE_MAX_ATTEMPTS = 6;
  private static readonly PROTOCOL_RETRY_DELAY_MS = 500;

  constructor() {
    this.config = { isConnected: false, adapterType: 'postgresql' };
  }

  onChange(callback: (payload: string) => void): () => void {
    this.changeListeners.push(callback);
    return () => {
      this.changeListeners = this.changeListeners.filter((cb) => cb !== callback);
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getPgErrorCode(err: unknown): string | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const c = (err as { code?: string }).code;
    return typeof c === 'string' ? c : undefined;
  }

  private isRetryablePgWriteError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = this.getPgErrorCode(err);
    const msg = err.message.toLowerCase();
    if (msg.includes('constraint') || msg.includes('not null') || msg.includes('unique')) return false;
    const retryCodes = ['40P01', '40001', '57P01', '57P02', '57P03', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
    if (code && retryCodes.includes(code)) return true;
    if (msg.includes('deadlock') || msg.includes('serialization failure')) return true;
    if (msg.includes('too many clients')) return true;
    if (msg.includes('connection') && (msg.includes('terminated') || msg.includes('closed'))) return true;
    return false;
  }

  private async runWithRetriesAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) { // PostgreSQL은 데드락 등 일시적 에러만 3회 재시도
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (!this.isRetryablePgWriteError(e) || attempt === 2) {
          throw e;
        }
        console.warn(`[DB] 쓰기 재시도 ${attempt + 1}/2 (${label}, async):`, e instanceof Error ? e.message : String(e));
        await this.sleep(ElectronDatabaseAdapter.PROTOCOL_RETRY_DELAY_MS);
      }
    }
    throw lastErr;
  }

  private requirePool(): Pool {
    if (!this.pool) throw new Error('DB가 초기화되지 않았습니다. initialize()를 호출하세요.');
    return this.pool;
  }

  private async closePool(): Promise<void> {
    if (!this.pool) return;
    try {
      if (this.listenerClient) {
        this.listenerClient.release();
        this.listenerClient = null;
      }
      await this.pool.end();
    } catch {
      /* ignore */
    }
    this.pool = null;
    this.config.isConnected = false;
  }

  /** 앱 종료 시 풀 정리 */
  async close(): Promise<void> {
    await this.closePool();
    this.pgConfig = null;
  }

  /**
   * 스키마 적용 + 부트스트랩(팀/마스터/카테고리/샘플).
   * Pool 생성, 연결 검증, DDL, 시드까지 수행합니다.
   */
  async initialize(): Promise<void> {
    if (this.pool && this.config.isConnected) return;

    await this.closePool();

    const conn = mergePgConnectionFromDiskAndEnv();
    this.pgConfig = conn;

    console.log('[DB] PostgreSQL 연결 시도:', `${conn.user}@${conn.host}:${conn.port}/${conn.database}`);

    // TCP keepalive 켜기(OS·런타임 기본 주기). 짧은 주기는 pg `keepAliveInitialDelayMillis`로 따로 두지 않음.
    // 서버 측 `tcp_keepalives_*`는 NAS 부하와 트레이드오프이므로 `docs/POSTGRESQL_PARITY_PLAN.md` QA 권장값 참고.
    this.pool = new Pool({
      host: conn.host,
      port: conn.port,
      user: conn.user,
      password: conn.password,
      database: conn.database,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
    });

    try {
      const p = this.requirePool();
      await p.query('SELECT 1');

      await p.query(SCHEMA_SQL);
      await this.ensureReferentialFKs();
      await this.runBootstraps();

      const mc = await p.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM members');
      const c = Number(mc.rows[0]?.c ?? '0');
      if (c === 0) {
        await this.seedSampleData();
      }

      this.listenerClient = await p.connect();
      await this.listenerClient.query('LISTEN db_changed');
      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'db_changed') {
          for (const cb of this.changeListeners) {
            cb(msg.payload || '');
          }
        }
      });

      this.config.isConnected = true;
      this.config.adapterType = 'postgresql';
      this.config.dbPath = undefined;
      this.config.pg = {
        host: conn.host,
        port: conn.port,
        user: conn.user,
        database: conn.database,
      };
      console.log('[DB] 연결 완료');
    } catch (err: unknown) {
      const msg = formatPgConnectionError(err);
      console.error('[DB] 초기화 실패:', msg);
      await this.closePool();
      throw new Error(msg);
    }
  }

  /** Pool 없이 입력값으로 연결 가능 여부 확인 (타임아웃 포함) */
  async testConnection(
    config: PgConnectionConfig
  ): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
    return testPgConnectionRaw(config);
  }

  /** 구 버전에서 FK 가 없을 수 있어 보강 */
  private async ensureReferentialFKs(): Promise<void> {
    const p = this.requirePool();
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_members_team'
        ) THEN
          ALTER TABLE members
            ADD CONSTRAINT fk_members_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
        END IF;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_logs_member'
        ) THEN
          ALTER TABLE work_logs
            ADD CONSTRAINT fk_work_logs_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;
        END IF;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_categories_parent'
        ) THEN
          ALTER TABLE categories
            ADD CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE;
        END IF;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    
    // 트리거 보강
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'work_logs_notify_trigger') THEN
          CREATE TRIGGER work_logs_notify_trigger
          AFTER INSERT OR UPDATE OR DELETE ON work_logs
          FOR EACH STATEMENT EXECUTE FUNCTION notify_db_change();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'work_logs_audit_trigger') THEN
          CREATE TRIGGER work_logs_audit_trigger
          AFTER INSERT OR UPDATE OR DELETE ON work_logs
          FOR EACH ROW EXECUTE FUNCTION log_audit_trail();
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'members_notify_trigger') THEN
          CREATE TRIGGER members_notify_trigger
          AFTER INSERT OR UPDATE OR DELETE ON members
          FOR EACH STATEMENT EXECUTE FUNCTION notify_db_change();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'members_audit_trigger') THEN
          CREATE TRIGGER members_audit_trigger
          AFTER INSERT OR UPDATE OR DELETE ON members
          FOR EACH ROW EXECUTE FUNCTION log_audit_trail();
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'teams_notify_trigger') THEN
          CREATE TRIGGER teams_notify_trigger
          AFTER INSERT OR UPDATE OR DELETE ON teams
          FOR EACH STATEMENT EXECUTE FUNCTION notify_db_change();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'teams_audit_trigger') THEN
          CREATE TRIGGER teams_audit_trigger
          AFTER INSERT OR UPDATE OR DELETE ON teams
          FOR EACH ROW EXECUTE FUNCTION log_audit_trail();
        END IF;
      END $$;
    `);
  }

  private async runBootstraps(): Promise<void> {
    const p = this.requirePool();
    await this.runWithRetriesAsync('runBootstraps', async () => {
      // 마이그레이션: department 컬럼 추가 및 기본값 설정
      await p.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS department TEXT`);
      await p.query(`UPDATE teams SET department = '품질보증실' WHERE department IS NULL`);

      await this.ensureDefaultTeams(p);
      await p.query(
        `UPDATE members SET team_id = $1 WHERE team_id IS NULL OR team_id = '' OR team_id = $2`,
        [TEAM_QG2_ID, '']
      );
      await this.ensureMasterDefaults(p);
      await this.initializeCategories(p);
    });
  }

  private async ensureMasterDefaults(exec: SqlExecutor): Promise<void> {
    const hasId = await exec.query('SELECT 1 FROM app_settings WHERE key = $1 LIMIT 1', ['master_login_id']);
    if (hasId.rowCount === 0) {
      await exec.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())`,
        ['master_login_id', '201521570']
      );
    }
    const hasPw = await exec.query('SELECT 1 FROM app_settings WHERE key = $1 LIMIT 1', ['master_password_hash']);
    if (hasPw.rowCount === 0) {
      await exec.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())`, [
        'master_password_hash',
        hashTeamlogPassword('1111'),
      ]);
    }
  }

  private async ensureDefaultTeams(exec: SqlExecutor): Promise<void> {
    const c = await exec.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM teams');
    if (Number(c.rows[0]?.n ?? '0') === 0) {
      for (const t of DEFAULT_TEAMS_SEED) {
        await exec.query('INSERT INTO teams (id, name, sort_order) VALUES ($1, $2, $3)', [t.id, t.name, t.sortOrder]);
      }
    }
  }

  private async initializeCategories(exec: SqlExecutor): Promise<void> {
    const cnt = await exec.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM categories');
    if (Number(cnt.rows[0]?.n ?? '0') !== 0) return;

    const roots: string[] = [];
    const children: { parent: string; child: string }[] = [];
    const seenRoots = new Set<string>();
    QA_CATEGORIES_FLAT.forEach((displayName) => {
      if (displayName.includes(' > ')) {
        const [p, c] = displayName.split(' > ');
        if (!seenRoots.has(p!)) {
          seenRoots.add(p!);
          roots.push(p!);
        }
        children.push({ parent: p!, child: c!.trim() });
      } else if (!seenRoots.has(displayName)) {
        seenRoots.add(displayName);
        roots.push(displayName);
      }
    });
    const parentIds = new Map<string, number>();
    for (let i = 0; i < roots.length; i++) {
      const name = roots[i]!;
      const r = await exec.query<{ id: number }>(
        'INSERT INTO categories (name, parent_id, sort_order) VALUES ($1, NULL, $2) RETURNING id',
        [name, i + 1]
      );
      parentIds.set(name, r.rows[0]!.id);
    }
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      const pid = parentIds.get(c.parent) ?? null;
      await exec.query('INSERT INTO categories (name, parent_id, sort_order) VALUES ($1, $2, $3)', [
        c.child,
        pid,
        i + 1,
      ]);
    }
  }

  private async seedSampleData(): Promise<void> {
    const { members, logs, categories } = generateSampleData();
    const teams: WorkTeam[] = DEFAULT_TEAMS_SEED.map((t) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder }));
    await this.importData({ teams, members, logs, categories });
    console.log('[DB] 내장 샘플 데이터 삽입 완료');
  }

  getConfig(): DatabaseConfig {
    return { ...this.config };
  }

  async setDbPath(_newPath: string): Promise<void> {
    throw new Error(
      'PostgreSQL 모드에서는 SQLite dbPath를 사용하지 않습니다. userData/settings.json의 "pg" 또는 PG* 환경 변수를 설정하세요.'
    );
  }

  isConnected(): boolean {
    return this.config.isConnected && this.pool !== null;
  }

  /** 표시용 연결 요약 (비밀번호 제외) */
  getConnectionSummary(): string {
    const c = this.pgConfig ?? mergePgConnectionFromDiskAndEnv();
    return `${c.user}@${c.host}:${c.port}/${c.database}`;
  }

  private async fetchWorkLogById(exec: SqlExecutor, id: string): Promise<WorkLog | null> {
    const r = await exec.query(`${WORK_LOG_SELECT} FROM work_logs w WHERE w.id = $1`, [id]);
    if (r.rows.length === 0) return null;
    return mapRowToWorkLog(r.rows[0] as Record<string, unknown>);
  }

  /**
   * 삭제·수정·추가를 단일 트랜잭션으로 처리합니다.
   * Pool에서 Client 를 빌려 BEGIN → 작업 → COMMIT, 실패 시 ROLLBACK.
   */
  async saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void> {
    await this.runWithRetriesAsync('saveLogsBatch', () => this.saveLogsBatchTx(payload));
  }

  private async saveLogsBatchTx(payload: SaveLogsBatchPayload): Promise<void> {
    const { requesterMemberId, deletedLogIds, updatedLogs, newLogs } = payload;
    if (!requesterMemberId) {
      throw new Error('일괄 저장에는 작성자(member) id가 필요합니다.');
    }

    const pool = this.requirePool();
    const client = await pool.connect();

    const mergePersisted = (current: WorkLog, updates: Partial<WorkLog>): WorkLog => {
      if (updates.memberId !== undefined && updates.memberId !== current.memberId) {
        throw new Error('담당자 변경은 허용되지 않습니다.');
      }
      const u: WorkLog = { ...current, ...updates };
      u.duration =
        updates.duration !== undefined ? normalizeDurationForStorage(updates.duration) : normalizeDurationForStorage(current.duration);
      u.count =
        updates.count !== undefined ? normalizeCountForStorage(updates.count) : normalizeCountForStorage(current.count);
      u.date = ensureDateYYYYMMDD(u.date);
      return u;
    };

    try {
      await client.query('BEGIN');

      for (const delId of deletedLogIds) {
        const row = await this.fetchWorkLogById(client, delId);
        if (!row) throw new Error(`삭제할 업무를 찾을 수 없습니다. (id=${delId})`);
        if (row.memberId !== requesterMemberId) throw new Error('삭제: 본인 소유 업무가 아닙니다.');
        const dr = await client.query('DELETE FROM work_logs WHERE id = $1 AND member_id = $2', [delId, requesterMemberId]);
        if (dr.rowCount !== 1) throw new Error(`삭제 처리 실패 (id=${delId})`);
      }

      for (const { id: uid, updates } of updatedLogs) {
        if (!updates || Object.keys(updates).length === 0) continue;
        const cur = await this.fetchWorkLogById(client, uid);
        if (!cur) throw new Error(`업무 기록을 찾을 수 없습니다. (id=${uid})`);
        if (cur.memberId !== requesterMemberId) throw new Error('수정: 본인 소유 업무가 아닙니다.');
        const merged = mergePersisted(cur, updates);
        const ur = await client.query(
          `UPDATE work_logs SET member_id = $1, date = $2::date, category = $3, content = $4, issues = $5,
                 duration = $6, count = $7, status = $8, work_indicator = $9, task_code = $10,
                 updated_at = now()
           WHERE id = $11 AND member_id = $12`,
          [
            merged.memberId,
            merged.date,
            merged.category,
            merged.content,
            merged.issues ?? null,
            merged.duration,
            merged.count,
            merged.status || '완료',
            merged.workIndicator || '기타/행정',
            merged.taskCode ?? null,
            uid,
            requesterMemberId,
          ]
        );
        if (ur.rowCount !== 1) throw new Error(`업무 수정에 실패했습니다. (id=${uid})`);
      }

      if (newLogs.length > 0) {
        const ids: string[] = [];
        const memberIds: string[] = [];
        const dates: string[] = [];
        const categories: string[] = [];
        const contents: string[] = [];
        const issues: (string | null)[] = [];
        const durations: number[] = [];
        const counts: number[] = [];
        const statuses: string[] = [];
        const workIndicators: string[] = [];
        const taskCodes: (string | null)[] = [];
        const createdAts: string[] = [];
        const updatedAts: string[] = [];

        const now = new Date().toISOString();

        for (const log of newLogs) {
          if (log.memberId !== requesterMemberId) {
            throw new Error('추가: 다른 멤버 명의의 업무는 저장할 수 없습니다.');
          }
          ids.push(crypto.randomUUID());
          memberIds.push(log.memberId);
          dates.push(ensureDateYYYYMMDD(log.date));
          categories.push(log.category);
          contents.push(log.content);
          issues.push(log.issues || null);
          durations.push(normalizeDurationForStorage(log.duration));
          counts.push(normalizeCountForStorage(log.count));
          statuses.push(log.status || '완료');
          workIndicators.push(log.workIndicator || '기타/행정');
          taskCodes.push(log.taskCode || null);
          createdAts.push(now);
          updatedAts.push(now);
        }

        const unnestSql = `
          INSERT INTO work_logs (id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code, created_at, updated_at)
          SELECT * FROM UNNEST(
            $1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::text[],
            $7::float8[], $8::int4[], $9::text[], $10::text[], $11::text[],
            $12::timestamptz[], $13::timestamptz[]
          )
        `;
        await client.query(unnestSql, [
          ids, memberIds, dates, categories, contents, issues,
          durations, counts, statuses, workIndicators, taskCodes,
          createdAts, updatedAts
        ]);
      }

      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 아래: 나머지 IDatabaseAdapter API (모두 async + pg)
  // ─────────────────────────────────────────────────────────────────────────────

  private async deleteTeamCascade(client: PoolClient, teamId: string): Promise<void> {
    const mids = await client.query<{ id: string }>('SELECT id FROM members WHERE team_id = $1', [teamId]);
    for (const row of mids.rows) {
      await client.query('DELETE FROM work_logs WHERE member_id = $1', [row.id]);
      await client.query('DELETE FROM members WHERE id = $1', [row.id]);
    }
    await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
  }

  async getTeams(): Promise<WorkTeam[]> {
    return await this.runWithRetriesAsync('getTeams', async () => {
      const r = await this.requirePool().query(
        `
        SELECT id, name, department, sort_order AS "sortOrder",
          admin_login_id AS "adminLoginId",
          CASE WHEN admin_password_hash IS NOT NULL AND admin_password_hash != '' THEN 1 ELSE 0 END AS "hasPw",
          admin_extra_json AS "adminExtraJson"
        FROM teams ORDER BY sort_order
      `
      );
      return r.rows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        department: (row.department as string | null) ?? '품질보증실',
        sortOrder: Number(row.sortOrder),
        adminLoginId: (row.adminLoginId as string | null) ?? null,
        hasAdminPassword: Number(row.hasPw) === 1,
        extraAdminAccounts: toPreviewExtras(parseStoredAdminExtras((row.adminExtraJson as string | null) ?? null)),
      })) as WorkTeam[];
    });
  }

  async insertTeam(name: string): Promise<WorkTeam> {
    return await this.runWithRetriesAsync('insertTeam', async () => {
      const id = crypto.randomUUID();
      const pool = this.requirePool();
      const m = await pool.query<{ max: string | null }>('SELECT MAX(sort_order)::text AS max FROM teams');
      const sortOrder = Number(m.rows[0]?.max ?? '0') + 1;
      await pool.query('INSERT INTO teams (id, name, sort_order) VALUES ($1, $2, $3)', [id, name, sortOrder]);
      return { id, name, sortOrder, adminLoginId: null, hasAdminPassword: false };
    });
  }

  async verifyMasterLogin(loginId: string, password: string): Promise<boolean> {
    const pool = this.requirePool();
    const idRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', ['master_login_id']);
    if (!idRow.rows[0] || idRow.rows[0].value !== loginId) return false;
    const pw = (password ?? '').trim();
    if (pw === '') return true;
    const pwRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', ['master_password_hash']);
    if (!pwRow.rows[0]) return false;
    return pwRow.rows[0].value === hashTeamlogPassword(password);
  }

  async verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean> {
    const hp = hashTeamlogPassword(password);
    const pool = this.requirePool();
    if (teamId === GLOBAL_TEAM_ADMIN_SCOPE_ID) {
      const idRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_login_id',
      ]);
      const pwRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_password_hash',
      ]);
      if (
        idRow.rows[0]?.value?.trim() &&
        pwRow.rows[0]?.value &&
        idRow.rows[0].value === loginId &&
        pwRow.rows[0].value === hp
      )
        return true;
      const extraRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_extra_json',
      ]);
      for (const e of parseStoredAdminExtras(extraRow.rows[0]?.value ?? null)) {
        if (e.loginId === loginId && e.passwordHash === hp) return true;
      }
      return false;
    }
    const row = await pool.query<{
      admin_login_id: string | null;
      admin_password_hash: string | null;
      admin_extra_json: string | null;
    }>('SELECT admin_login_id, admin_password_hash, admin_extra_json FROM teams WHERE id = $1', [teamId]);
    const x = row.rows[0];
    if (!x) return false;
    if (x.admin_login_id && x.admin_password_hash && x.admin_login_id === loginId && x.admin_password_hash === hp)
      return true;
    for (const e of parseStoredAdminExtras(x.admin_extra_json ?? null)) {
      if (e.loginId === loginId && e.passwordHash === hp) return true;
    }
    return false;
  }

  async saveAdminTeamsTransaction(payload: {
    teams: Array<{
      id: string;
      name: string;
      department?: string | null;
      sortOrder: number;
      adminLoginId: string;
      passwordPlain?: string | null;
      extraAdmins?: import('../../src/constants/globalTeamAdmin').AdminExtraAccountPayload[];
    }>;
    deletedTeamIds: string[];
    globalTeamAdmin?: GlobalTeamAdminSavePayload;
    workRecordStartDate?: string | null;
  }): Promise<void> {
    const teamExtraMerged = new Map<string, string>();
    const pool = this.requirePool();

    for (const t of payload.teams) {
      if (t.extraAdmins !== undefined) {
        const oldRow = await pool.query<{ admin_extra_json: string | null }>(
          'SELECT admin_extra_json FROM teams WHERE id = $1',
          [t.id]
        );
        const merged = await mergeAdminExtrasOnSave(oldRow.rows[0]?.admin_extra_json ?? null, t.extraAdmins, (pw) =>
          Promise.resolve(hashTeamlogPassword(pw))
        );
        teamExtraMerged.set(t.id, serializeAdminExtras(merged));
      }
    }
    let globalExtraPrecomputed: string | undefined;
    if (payload.globalTeamAdmin && payload.globalTeamAdmin.extraAdmins !== undefined) {
      const oldRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_extra_json',
      ]);
      const merged = await mergeAdminExtrasOnSave(oldRow.rows[0]?.value ?? null, payload.globalTeamAdmin.extraAdmins, (pw) =>
        Promise.resolve(hashTeamlogPassword(pw))
      );
      globalExtraPrecomputed = serializeAdminExtras(merged);
    }

    await this.runWithRetriesAsync('saveAdminTeamsTransaction', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const tid of payload.deletedTeamIds) {
          await this.deleteTeamCascade(client, tid);
        }
        for (const t of payload.teams) {
          const exists = await client.query('SELECT 1 FROM teams WHERE id = $1', [t.id]);
          const pw = t.passwordPlain;
          const hasNewPw = pw !== undefined && pw !== null && String(pw).length > 0;
          const extraJson = teamExtraMerged.get(t.id);

          if (exists.rowCount) {
            if (hasNewPw) {
              if (extraJson !== undefined) {
                await client.query(
                  `UPDATE teams SET name = $1, department = $2, sort_order = $3, admin_login_id = $4, admin_password_hash = $5, admin_extra_json = $6 WHERE id = $7`,
                  [t.name, t.department || '품질보증실', t.sortOrder, t.adminLoginId || null, hashTeamlogPassword(String(pw)), extraJson, t.id]
                );
              } else {
                await client.query(
                  `UPDATE teams SET name = $1, department = $2, sort_order = $3, admin_login_id = $4, admin_password_hash = $5 WHERE id = $6`,
                  [t.name, t.department || '품질보증실', t.sortOrder, t.adminLoginId || null, hashTeamlogPassword(String(pw)), t.id]
                );
              }
            } else if (extraJson !== undefined) {
              await client.query(
                `UPDATE teams SET name = $1, department = $2, sort_order = $3, admin_login_id = $4, admin_extra_json = $5 WHERE id = $6`,
                [t.name, t.department || '품질보증실', t.sortOrder, t.adminLoginId || null, extraJson, t.id]
              );
            } else {
              await client.query(`UPDATE teams SET name = $1, department = $2, sort_order = $3, admin_login_id = $4 WHERE id = $5`, [
                t.name,
                t.department || '품질보증실',
                t.sortOrder,
                t.adminLoginId || null,
                t.id,
              ]);
            }
          } else {
            const h = hasNewPw ? hashTeamlogPassword(String(pw)) : null;
            const insExtra = extraJson !== undefined ? extraJson : null;
            await client.query(
              `INSERT INTO teams (id, name, department, sort_order, admin_login_id, admin_password_hash, admin_extra_json) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [t.id, t.name, t.department || '품질보증실', t.sortOrder, t.adminLoginId || null, h, insExtra]
            );
          }
        }
        if (payload.globalTeamAdmin !== undefined) {
          await this.applyGlobalTeamAdminSaveClient(client, payload.globalTeamAdmin, globalExtraPrecomputed);
        }
        if (payload.workRecordStartDate !== undefined) {
          const raw = (payload.workRecordStartDate ?? '').trim();
          const v = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
          await client.query(
            `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            ['global_work_record_start_date', v]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
    });
  }

  private async applyGlobalTeamAdminSaveClient(
    client: PoolClient,
    g: GlobalTeamAdminSavePayload,
    precomputedExtraJson?: string
  ): Promise<void> {
    const ins = `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    if (g === null) {
      await client.query('DELETE FROM app_settings WHERE key = ANY($1::text[])', [
        ['global_team_admin_login_id', 'global_team_admin_password_hash', 'global_team_admin_extra_json'],
      ]);
      return;
    }
    const login = (g.adminLoginId ?? '').trim();
    if (!login) {
      await client.query('DELETE FROM app_settings WHERE key = ANY($1::text[])', [
        ['global_team_admin_login_id', 'global_team_admin_password_hash', 'global_team_admin_extra_json'],
      ]);
      return;
    }
    await client.query(ins, ['global_team_admin_login_id', login]);
    const pw = g.passwordPlain;
    const hasNewPw = pw !== undefined && pw !== null && String(pw).length > 0;
    if (hasNewPw) {
      await client.query(ins, ['global_team_admin_password_hash', hashTeamlogPassword(String(pw))]);
    }
    if (precomputedExtraJson !== undefined) {
      await client.query(ins, ['global_team_admin_extra_json', precomputedExtraJson]);
    }
  }

  async changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void> {
    const cur = params.currentPassword;
    const neu = params.newPassword;
    if (!neu?.length) {
      throw new Error('새 비밀번호를 입력해 주세요.');
    }
    const pool = this.requirePool();
    const upsert = `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

    if (params.scope === 'master') {
      const idRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', ['master_login_id']);
      const pwRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'master_password_hash',
      ]);
      if (!idRow.rows[0]?.value?.trim() || !pwRow.rows[0]?.value) {
        throw new Error('마스터 계정이 설정되지 않았습니다.');
      }
      if (pwRow.rows[0].value !== hashTeamlogPassword(cur)) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      await this.runWithRetriesAsync('changeAdminPasswordSelf.master', async () => {
        await pool.query(upsert, ['master_password_hash', hashTeamlogPassword(neu)]);
      });
      return;
    }

    if (params.scope === 'global') {
      const target = (params.adminLoginId ?? '').trim();
      const idRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_login_id',
      ]);
      const pwRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_password_hash',
      ]);
      const extraRow = await pool.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [
        'global_team_admin_extra_json',
      ]);
      const extras = parseStoredAdminExtras(extraRow.rows[0]?.value ?? null);
      const curH = hashTeamlogPassword(cur);
      const neuH = hashTeamlogPassword(neu);
      const primaryId = (idRow.rows[0]?.value ?? '').trim();

      if (!target || target === primaryId) {
        if (!primaryId || !pwRow.rows[0]?.value) {
          throw new Error('전체팀 관리자가 설정되지 않았습니다.');
        }
        if (pwRow.rows[0].value !== curH) {
          throw new Error('현재 비밀번호가 올바르지 않습니다.');
        }
        await this.runWithRetriesAsync('changeAdminPasswordSelf.globalPrimary', async () => {
          await pool.query(upsert, ['global_team_admin_password_hash', neuH]);
        });
        return;
      }
      const idx = extras.findIndex((e) => e.loginId === target);
      if (idx < 0) throw new Error('관리자 계정을 찾을 수 없습니다.');
      if (extras[idx].passwordHash !== curH) throw new Error('현재 비밀번호가 올바르지 않습니다.');
      extras[idx] = { loginId: target, passwordHash: neuH };
      await this.runWithRetriesAsync('changeAdminPasswordSelf.globalExtra', async () => {
        await pool.query(upsert, ['global_team_admin_extra_json', serializeAdminExtras(extras)]);
      });
      return;
    }

    const teamId = params.teamId!;
    const row = await pool.query<{
      admin_login_id: string | null;
      admin_password_hash: string | null;
      admin_extra_json: string | null;
    }>('SELECT admin_login_id, admin_password_hash, admin_extra_json FROM teams WHERE id = $1', [teamId]);
    const x = row.rows[0];
    const target = (params.adminLoginId ?? '').trim();
    const primaryId = (x?.admin_login_id ?? '').trim();
    const curH = hashTeamlogPassword(cur);
    const neuH = hashTeamlogPassword(neu);

    if (!target || target === primaryId) {
      if (!primaryId || !x?.admin_password_hash) {
        throw new Error('팀 관리자가 설정되지 않았습니다. 마스터 관리자에게 사번 등록을 요청하세요.');
      }
      if (x.admin_password_hash !== curH) throw new Error('현재 비밀번호가 올바르지 않습니다.');
      await this.runWithRetriesAsync('changeAdminPasswordSelf.teamPrimary', async () => {
        await pool.query('UPDATE teams SET admin_password_hash = $1 WHERE id = $2', [neuH, teamId]);
      });
      return;
    }
    const extras = parseStoredAdminExtras(x?.admin_extra_json ?? null);
    const idx = extras.findIndex((e) => e.loginId === target);
    if (idx < 0) throw new Error('관리자 계정을 찾을 수 없습니다.');
    if (extras[idx].passwordHash !== curH) throw new Error('현재 비밀번호가 올바르지 않습니다.');
    extras[idx] = { loginId: target, passwordHash: neuH };
    await this.runWithRetriesAsync('changeAdminPasswordSelf.teamExtra', async () => {
      await pool.query('UPDATE teams SET admin_extra_json = $1 WHERE id = $2', [serializeAdminExtras(extras), teamId]);
    });
  }

  async getAuditLogs(limit: number = 50): Promise<import('../../src/types/workLog').AuditLog[]> {
    return await this.runWithRetriesAsync('getAuditLogs', async () => {
      const r = await this.requirePool().query(`
        SELECT
          id,
          table_name AS "tableName",
          operation,
          record_id AS "recordId",
          old_data AS "oldData",
          new_data AS "newData",
          changed_at AS "changedAt"
        FROM audit_logs
        ORDER BY changed_at DESC
        LIMIT $1
      `, [limit]);
      return r.rows;
    });
  }

  async getAllMembers(): Promise<TeamMember[]> {
    return await this.runWithRetriesAsync('getAllMembers', async () => {
      const r = await this.requirePool().query(
        'SELECT id, name, role, avatar, status_message AS "statusMessage", team_id AS "teamId", employee_no AS "employeeNo" FROM members ORDER BY name'
      );
      return r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        avatar: row.avatar || undefined,
        statusMessage: row.statusMessage?.trim() ? row.statusMessage.trim() : undefined,
        teamId: row.teamId || '',
        employeeNo: row.employeeNo ?? undefined,
      })) as TeamMember[];
    });
  }

  async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    return await this.runWithRetriesAsync('getMembersByTeam', async () => {
      const r = await this.requirePool().query(
        'SELECT id, name, role, avatar, status_message AS "statusMessage", team_id AS "teamId", employee_no AS "employeeNo" FROM members WHERE team_id = $1 ORDER BY name',
        [teamId]
      );
      return r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        avatar: row.avatar || undefined,
        statusMessage: row.statusMessage?.trim() ? row.statusMessage.trim() : undefined,
        teamId: row.teamId || teamId,
        employeeNo: row.employeeNo ?? undefined,
      })) as TeamMember[];
    });
  }

  async getMemberById(id: string): Promise<TeamMember | null> {
    return await this.runWithRetriesAsync('getMemberById', async () => {
      const r = await this.requirePool().query(
        'SELECT id, name, role, avatar, status_message AS "statusMessage", team_id AS "teamId", employee_no AS "employeeNo" FROM members WHERE id = $1',
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        avatar: row.avatar || undefined,
        statusMessage: row.statusMessage?.trim() ? row.statusMessage.trim() : undefined,
        teamId: row.teamId || '',
        employeeNo: row.employeeNo ?? undefined,
      } as TeamMember;
    });
  }

  async insertMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember> {
    return await this.runWithRetriesAsync('insertMember', async () => {
      const id = crypto.randomUUID();
      await this.requirePool().query(
        'INSERT INTO members (id, name, role, avatar, status_message, team_id, employee_no) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          id,
          member.name,
          member.role,
          member.avatar || null,
          member.statusMessage?.trim() ? member.statusMessage.trim() : null,
          member.teamId,
          member.employeeNo?.trim() ? member.employeeNo.trim() : null,
        ]
      );
      return { id, ...member, employeeNo: member.employeeNo?.trim() || undefined };
    });
  }

  async updateMember(id: string, updates: Partial<TeamMember>): Promise<void> {
    const current = await this.getMemberById(id);
    if (!current) return;
    const updated = { ...current, ...updates };
    const st = updated.statusMessage;
    const statusRaw = st != null && String(st).trim() !== '' ? String(st).trim() : null;
    await this.runWithRetriesAsync('updateMember', async () => {
      await this.requirePool().query(
        `UPDATE members SET name = $1, role = $2, avatar = $3, status_message = $4, team_id = $5, employee_no = $6, updated_at = now() WHERE id = $7`,
        [
          updated.name,
          updated.role,
          updated.avatar || null,
          statusRaw || null,
          updated.teamId,
          updated.employeeNo?.trim() ? updated.employeeNo.trim() : null,
          id,
        ]
      );
    });
  }

  async deleteMember(id: string): Promise<void> {
    await this.runWithRetriesAsync('deleteMember', async () => {
      await this.requirePool().query('DELETE FROM members WHERE id = $1', [id]);
    });
  }

  async getAllLogs(): Promise<WorkLog[]> {
    return await this.runWithRetriesAsync('getAllLogs', async () => {
      const r = await this.requirePool().query(`${WORK_LOG_SELECT} FROM work_logs w ORDER BY w.date DESC, w.created_at DESC`);
      return r.rows.map((row) => mapRowToWorkLog(row as Record<string, unknown>));
    });
  }

  async getLogsByMemberId(memberId: string): Promise<WorkLog[]> {
    return await this.runWithRetriesAsync('getLogsByMemberId', async () => {
      const r = await this.requirePool().query(
        `${WORK_LOG_SELECT} FROM work_logs w WHERE w.member_id = $1 ORDER BY w.date DESC, w.created_at DESC`,
        [memberId]
      );
      return r.rows.map((row) => mapRowToWorkLog(row as Record<string, unknown>));
    });
  }

  async getLogsByDateRange(startDate: string, endDate: string): Promise<WorkLog[]> {
    return await this.runWithRetriesAsync('getLogsByDateRange', async () => {
      const r = await this.requirePool().query(
        `${WORK_LOG_SELECT} FROM work_logs w
        WHERE w.date >= $1::date AND w.date <= $2::date
        ORDER BY w.date DESC`,
        [startDate, endDate]
      );
      return r.rows.map((row) => mapRowToWorkLog(row as Record<string, unknown>));
    });
  }

  async getLogsByTeam(teamId: string): Promise<WorkLog[]> {
    return await this.runWithRetriesAsync('getLogsByTeam', async () => {
      const r = await this.requirePool().query(
        `${WORK_LOG_SELECT}
        FROM work_logs w
        INNER JOIN members m ON m.id = w.member_id
        WHERE m.team_id = $1
        ORDER BY w.date DESC, w.created_at DESC`,
        [teamId]
      );
      return r.rows.map((row) => mapRowToWorkLog(row as Record<string, unknown>));
    });
  }

  private mergePersistedLog(current: WorkLog, updates: Partial<WorkLog>): WorkLog {
    if (updates.memberId !== undefined && updates.memberId !== current.memberId) {
      throw new Error('담당자 변경은 허용되지 않습니다.');
    }
    const u: WorkLog = { ...current, ...updates };
    u.duration =
      updates.duration !== undefined ? normalizeDurationForStorage(updates.duration) : normalizeDurationForStorage(current.duration);
    u.count =
      updates.count !== undefined ? normalizeCountForStorage(updates.count) : normalizeCountForStorage(current.count);
    u.date = ensureDateYYYYMMDD(u.date);
    return u;
  }

  async insertLog(
    log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>,
    requesterMemberId?: string | null
  ): Promise<WorkLog> {
    if (requesterMemberId == null || requesterMemberId === '') {
      throw new Error('업무 저장 시 작성자 검증 정보가 필요합니다.');
    }
    if (log.memberId !== requesterMemberId) {
      throw new Error('다른 멤버 명의로 업무를 저장할 수 없습니다.');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const dateStr = ensureDateYYYYMMDD(log.date);
    const dur = normalizeDurationForStorage(log.duration);
    const cnt = normalizeCountForStorage(log.count);
    const wi = log.workIndicator || '기타/행정';
    const sql = `
      INSERT INTO work_logs (id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code, created_at, updated_at)
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::timestamptz)
    `;
    return await this.runWithRetriesAsync('insertLog', async () => {
      await this.requirePool().query(sql, [
        id,
        log.memberId,
        dateStr,
        log.category,
        log.content,
        log.issues || null,
        dur,
        cnt,
        log.status || '완료',
        wi,
        log.taskCode || null,
        now,
        now,
      ]);
      return {
        ...log,
        id,
        date: dateStr,
        duration: dur,
        count: cnt,
        status: (log.status || '완료') as WorkLog['status'],
        workIndicator: wi as WorkLog['workIndicator'],
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  async updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void> {
    if (requesterMemberId == null || requesterMemberId === '') {
      throw new Error('업무 수정 시 작성자 검증 정보가 필요합니다.');
    }
    const current = await this.fetchWorkLogById(this.requirePool(), id);
    if (!current) throw new Error(`업무 기록을 찾을 수 없습니다. (id=${id})`);
    if (current.memberId !== requesterMemberId) throw new Error('수정: 본인 소유 업무가 아닙니다.');
    const updated = this.mergePersistedLog(current, updates);
    await this.runWithRetriesAsync('updateLog', async () => {
      const res = await this.requirePool().query(
        `UPDATE work_logs SET member_id = $1, date = $2::date, category = $3, content = $4, issues = $5,
             duration = $6, count = $7, status = $8, work_indicator = $9, task_code = $10,
             updated_at = now()
        WHERE id = $11 AND member_id = $12`,
        [
          updated.memberId,
          updated.date,
          updated.category,
          updated.content,
          updated.issues ?? null,
          updated.duration,
          updated.count,
          updated.status || '완료',
          updated.workIndicator || '기타/행정',
          updated.taskCode ?? null,
          id,
          requesterMemberId,
        ]
      );
      if (res.rowCount !== 1) throw new Error(`업무 수정에 실패했습니다. (id=${id})`);
    });
  }

  async deleteLog(id: string, requesterMemberId?: string | null): Promise<void> {
    if (requesterMemberId == null || requesterMemberId === '') {
      throw new Error('업무 삭제 시 작성자 검증 정보가 필요합니다.');
    }
    const row = await this.fetchWorkLogById(this.requirePool(), id);
    if (!row) throw new Error(`삭제할 업무를 찾을 수 없습니다. (id=${id})`);
    if (row.memberId !== requesterMemberId) throw new Error('삭제: 본인 소유 업무가 아닙니다.');
    await this.runWithRetriesAsync('deleteLog', async () => {
      const res = await this.requirePool().query('DELETE FROM work_logs WHERE id = $1 AND member_id = $2', [
        id,
        requesterMemberId,
      ]);
      if (res.rowCount !== 1) throw new Error(`업무 삭제에 실패했습니다. (id=${id})`);
    });
  }

  async deleteLogsByMemberId(memberId: string): Promise<void> {
    await this.runWithRetriesAsync('deleteLogsByMemberId', async () => {
      await this.requirePool().query('DELETE FROM work_logs WHERE member_id = $1', [memberId]);
    });
  }

  async getCategoriesTree(): Promise<Category[]> {
    return await this.runWithRetriesAsync('getCategoriesTree', async () => {
      const r = await this.requirePool().query(
        'SELECT id, name, parent_id AS "parentId", sort_order AS "sortOrder" FROM categories ORDER BY sort_order'
      );
      return r.rows as Category[];
    });
  }

  async saveCategoriesTree(categories: Category[]): Promise<void> {
    await this.runWithRetriesAsync('saveCategoriesTree', async () => {
      const pool = this.requirePool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('TRUNCATE categories RESTART IDENTITY CASCADE');
        const idMap = new Map<number, number>();
        const roots = categories.filter((c) => c.parentId == null).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const children = categories
          .filter((c) => c.parentId != null)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        for (let i = 0; i < roots.length; i++) {
          const cat = roots[i]!;
          const ins = await client.query<{ id: number }>(
            'INSERT INTO categories (name, parent_id, sort_order) VALUES ($1, NULL, $2) RETURNING id',
            [cat.name, i + 1]
          );
          idMap.set(cat.id, ins.rows[0]!.id);
        }
        for (let i = 0; i < children.length; i++) {
          const cat = children[i]!;
          const newParentId = idMap.get(cat.parentId!);
          await client.query('INSERT INTO categories (name, parent_id, sort_order) VALUES ($1, $2, $3)', [
            cat.name,
            newParentId ?? null,
            i + 1,
          ]);
        }
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
    });
  }

  async getAllCategories(): Promise<string[]> {
    return await this.runWithRetriesAsync('getAllCategories', async () => {
      const tree = await this.getCategoriesTree();
      const byId = new Map<number, Category>();
      tree.forEach((c) => byId.set(c.id, c));
      return tree
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((c) => {
          if (c.parentId == null) return c.name;
          const parent = byId.get(c.parentId);
          return parent ? `${parent.name} > ${c.name}` : c.name;
        });
    });
  }

  async saveCategories(categories: string[]): Promise<void> {
    const tree: Category[] = [];
    const parentNames = new Map<string, number>();
    let nextId = 1;
    categories.forEach((displayName, idx) => {
      if (displayName.includes(' > ')) {
        const [parentName, childName] = displayName.split(' > ');
        let parentId = parentNames.get(parentName!);
        if (parentId == null) {
          parentId = nextId++;
          tree.push({ id: parentId, name: parentName!, parentId: null, sortOrder: tree.length + 1 });
          parentNames.set(parentName!, parentId);
        }
        tree.push({ id: nextId++, name: childName!.trim(), parentId, sortOrder: tree.length + 1 });
      } else {
        tree.push({ id: nextId++, name: displayName, parentId: null, sortOrder: idx + 1 });
      }
    });
    await this.saveCategoriesTree(tree);
  }

  async getSetting(key: string): Promise<string | null> {
    const r = await this.requirePool().query('SELECT value FROM app_settings WHERE key = $1', [key]);
    return r.rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.runWithRetriesAsync('setSetting', async () => {
      await this.requirePool().query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value]
      );
    });
  }

  async clearAllData(): Promise<void> {
    await this.runWithRetriesAsync('clearAllData', async () => {
      const p = this.requirePool();
      await p.query('DELETE FROM work_logs');
      await p.query('DELETE FROM members');
    });
  }

  async exportData(): Promise<{ teams: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }> {
    const [teams, members, logs, categories] = await Promise.all([
      this.getTeams(),
      this.getAllMembers(),
      this.getAllLogs(),
      this.getAllCategories(),
    ]);
    return { teams, members, logs, categories };
  }

  async importData(data: { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] }): Promise<void> {
    type TeamAdminSnap = {
      admin_login_id: string | null;
      admin_password_hash: string | null;
      admin_extra_json: string | null;
    };
    const pool = this.requirePool();
    const adminSnap = new Map<string, TeamAdminSnap>();
    try {
      const rows = await pool.query<{
        id: string;
        admin_login_id: string | null;
        admin_password_hash: string | null;
        admin_extra_json: string | null;
      }>('SELECT id, admin_login_id, admin_password_hash, admin_extra_json FROM teams');
      for (const r of rows.rows) {
        adminSnap.set(r.id, {
          admin_login_id: r.admin_login_id ?? null,
          admin_password_hash: r.admin_password_hash ?? null,
          admin_extra_json: r.admin_extra_json ?? null,
        });
      }
    } catch {
      /* ignore */
    }

    await this.runWithRetriesAsync('importData', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM work_logs');
        await client.query('DELETE FROM members');
        if (data.teams && data.teams.length > 0) {
          await client.query('DELETE FROM teams');
          for (const t of data.teams) {
            const preserve = shouldPreserveImportedTeamAdmin(t);
            const snap = adminSnap.get(t.id);
            let adminId: string | null;
            let adminHash: string | null;
            let adminExtra: string | null;
            if (preserve && snap) {
              adminId = snap.admin_login_id;
              adminHash = snap.admin_password_hash;
              adminExtra = snap.admin_extra_json;
            } else {
              adminId = (t.adminLoginId ?? '').trim() || null;
              adminHash = null;
              adminExtra = null;
            }
            await client.query(
              'INSERT INTO teams (id, name, sort_order, admin_login_id, admin_password_hash, admin_extra_json) VALUES ($1, $2, $3, $4, $5, $6)',
              [t.id, t.name, t.sortOrder, adminId, adminHash, adminExtra]
            );
          }
        } else {
          await this.ensureDefaultTeams(client);
        }
        await this.importMembersAndLogsClient(client, data);
        await this.saveCategoriesWithClient(client, data.categories);
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
    });
  }

  private async importMembersAndLogsClient(
    client: PoolClient,
    data: { members: TeamMember[]; logs: WorkLog[] }
  ): Promise<void> {
    if (data.members.length > 0) {
      const ids: string[] = [];
      const names: string[] = [];
      const roles: string[] = [];
      const avatars: (string | null)[] = [];
      const statusMsgs: (string | null)[] = [];
      const teamIds: string[] = [];
      const employeeNos: (string | null)[] = [];
      for (const m of data.members) {
        ids.push(m.id);
        names.push(m.name);
        roles.push(m.role);
        avatars.push(m.avatar || null);
        statusMsgs.push(m.statusMessage?.trim() ? m.statusMessage.trim() : null);
        teamIds.push(m.teamId || TEAM_QG2_ID);
        employeeNos.push(m.employeeNo?.trim() ? m.employeeNo.trim() : null);
      }
      await client.query(`
        INSERT INTO members (id, name, role, avatar, status_message, team_id, employee_no)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
      `, [ids, names, roles, avatars, statusMsgs, teamIds, employeeNos]);
    }

    if (data.logs.length > 0) {
      const ids: string[] = [];
      const memberIds: string[] = [];
      const dates: string[] = [];
      const categories: string[] = [];
      const contents: string[] = [];
      const issues: (string | null)[] = [];
      const durations: number[] = [];
      const counts: number[] = [];
      const statuses: string[] = [];
      const workIndicators: string[] = [];
      const taskCodes: (string | null)[] = [];
      const createdAts: string[] = [];
      const updatedAts: string[] = [];

      for (const l of data.logs) {
        ids.push(l.id);
        memberIds.push(l.memberId);
        dates.push(ensureDateYYYYMMDD(l.date));
        categories.push(l.category);
        contents.push(l.content);
        issues.push(l.issues ?? null);
        durations.push(clampDurationForImport(l.duration));
        counts.push(clampCountForImport(l.count));
        statuses.push(l.status || '완료');
        workIndicators.push(l.workIndicator || '기타/행정');
        taskCodes.push(l.taskCode ?? null);
        createdAts.push(l.createdAt);
        updatedAts.push(l.updatedAt);
      }

      await client.query(`
        INSERT INTO work_logs (id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code, created_at, updated_at)
        SELECT * FROM UNNEST(
          $1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::text[],
          $7::float8[], $8::int4[], $9::text[], $10::text[], $11::text[],
          $12::timestamptz[], $13::timestamptz[]
        )
      `, [
        ids, memberIds, dates, categories, contents, issues,
        durations, counts, statuses, workIndicators, taskCodes,
        createdAts, updatedAts
      ]);
    }
  }

  private async saveCategoriesWithClient(client: PoolClient, categories: string[]): Promise<void> {
    const tree: Category[] = [];
    const parentNames = new Map<string, number>();
    let nextId = 1;
    categories.forEach((displayName, idx) => {
      if (displayName.includes(' > ')) {
        const [parentName, childName] = displayName.split(' > ');
        let parentId = parentNames.get(parentName!);
        if (parentId == null) {
          parentId = nextId++;
          tree.push({ id: parentId, name: parentName!, parentId: null, sortOrder: tree.length + 1 });
          parentNames.set(parentName!, parentId);
        }
        tree.push({ id: nextId++, name: childName!.trim(), parentId, sortOrder: tree.length + 1 });
      } else {
        tree.push({ id: nextId++, name: displayName, parentId: null, sortOrder: idx + 1 });
      }
    });
    await client.query('TRUNCATE categories RESTART IDENTITY CASCADE');
    const idMap = new Map<number, number>();
    const roots = tree.filter((c) => c.parentId == null).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const children = tree.filter((c) => c.parentId != null).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (let i = 0; i < roots.length; i++) {
      const cat = roots[i]!;
      const ins = await client.query<{ id: number }>(
        'INSERT INTO categories (name, parent_id, sort_order) VALUES ($1, NULL, $2) RETURNING id',
        [cat.name, i + 1]
      );
      idMap.set(cat.id, ins.rows[0]!.id);
    }
    for (let i = 0; i < children.length; i++) {
      const cat = children[i]!;
      const newParentId = idMap.get(cat.parentId!);
      await client.query('INSERT INTO categories (name, parent_id, sort_order) VALUES ($1, $2, $3)', [
        cat.name,
        newParentId ?? null,
        i + 1,
      ]);
    }
  }
}
