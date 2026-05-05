/**
 * ElectronDatabaseAdapter - Main process 전용 SQLite 어댑터
 * 공유 폴더 DB 파일 지원 (네트워크 경로 포함)
 *
 * WAL 모드 확인: DB 파일과 같은 폴더에 .db-wal, .db-shm 파일이 생성되면 WAL 활성화됨.
 * (공유 폴더/네트워크 드라이브에서는 WAL이 실패할 수 있어 DELETE 모드로 자동 전환)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';
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
import {
  clampCountForImport,
  clampDurationForImport,
  normalizeCountForStorage,
  normalizeDurationForStorage,
} from '../../src/utils/workLogNumeric';

/** YYYY-MM-DD 10자리 포맷 강제 (저장/비교 표준) */
function ensureDateYYYYMMDD(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return value.slice(0, 10);
}

const PWD_SALT = 'teamlog';

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw + PWD_SALT, 'utf8').digest('hex');
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    issues TEXT,
    duration REAL NOT NULL CHECK (duration >= 0),
    count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
    status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
    work_indicator TEXT NOT NULL DEFAULT '기타/행정' CHECK (work_indicator IN ('R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정')),
    task_code TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date);
CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
`;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSavedDbPath(): string | null {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.dbPath || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveDbPath(dbPath: string): void {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify({ dbPath }));
}

export class ElectronDatabaseAdapter {
  private db: Database.Database | null = null;
  private dbPath: string;
  private config: { dbPath?: string; isConnected: boolean; adapterType: string };

  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'team-worklog.db');
    this.config = { dbPath: this.dbPath, isConnected: false, adapterType: 'sqlite' };
  }

  async initialize(): Promise<void> {
    if (this.db) return; // 이미 초기화됨
    const savedPath = loadSavedDbPath();
    if (savedPath) {
      this.dbPath = savedPath;
    }

    const dir = path.dirname(this.dbPath);
    const dbExists = fs.existsSync(this.dbPath);
    const isNetworkPath = this.dbPath.startsWith('\\\\') || /^[A-Za-z]:\\.*$/.test(this.dbPath) && this.dbPath.includes('\\\\');

    console.log('[DB] 연결 시도:', this.dbPath);
    console.log('[DB] 파일 존재:', dbExists ? '예' : '아니오 (신규 생성)');
    if (isNetworkPath) console.log('[DB] 네트워크/공유 경로 감지 - WAL 실패 시 DELETE 모드로 전환');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      this.db = new Database(this.dbPath);

      try {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        const walMode = (this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string })?.journal_mode || 'unknown';
        const syncVal = (this.db.prepare('PRAGMA synchronous').get() as { synchronous: number })?.synchronous ?? -1;
        console.log('[DB] WAL 모드:', walMode, '| synchronous:', syncVal === 1 ? 'NORMAL' : syncVal);
      } catch (walErr: unknown) {
        console.error('[DB] WAL 설정 실패 (공유폴더/네트워크 드라이브일 수 있음):', walErr instanceof Error ? walErr.message : String(walErr));
        console.error('[DB] 상세:', JSON.stringify(walErr, null, 2));
        this.db.pragma('journal_mode = DELETE');
        this.db.pragma('synchronous = FULL');
        console.log('[DB] DELETE 모드로 전환 (동시성 제한됨)');
      }

      this.db.pragma('foreign_keys = ON');
      this.db.exec(SCHEMA_SQL);
      this.runMigrations();
      this.initializeCategories();

      // DB가 비어있으면 내장 샘플 데이터 삽입 (exe 실행 시 바로 표시)
      const memberCount = (this.db!.prepare('SELECT COUNT(*) as count FROM members').get() as { count: number }).count;
      if (memberCount === 0) {
        await this.seedSampleData();
      }

      this.config.isConnected = true;
      this.config.dbPath = this.dbPath;
      console.log('[DB] 연결 완료');
    } catch (err: unknown) {
      console.error('[DB] 초기화 실패:', err instanceof Error ? err.message : String(err));
      console.error('[DB] 경로:', this.dbPath);
      console.error('[DB] 스택:', err instanceof Error ? err.stack : undefined);
      throw err;
    }
  }

  private runMigrations(): void {
    // work_logs: 구 urgency/difficulty CHECK 제약 제거 (신규값 '1일 이내' 등 허용)
    try {
      const row = this.db!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='work_logs'").get() as { sql: string } | undefined;
      const sql = row?.sql || '';
      if (sql.includes("urgency IN ('매우높음'")) {
        const cols = (this.db!.prepare("PRAGMA table_info(work_logs)").all() as { name: string }[]).map(c => c.name);
        const hasIssues = cols.includes('issues');
        const selIssues = hasIssues ? 'issues' : 'NULL';
        this.db!.exec(`
          CREATE TABLE work_logs_new (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            issues TEXT,
            duration REAL NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
            urgency TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
          )
        `);
        this.db!.exec(`
          INSERT INTO work_logs_new SELECT
            id, member_id, date, category, content, ${selIssues}, duration, count, status,
            CASE urgency
              WHEN '매우높음' THEN '1일 이내'
              WHEN '높음' THEN '3일 이내'
              WHEN '중간' THEN '7일 이내'
              WHEN '낮음' THEN '2주 이내'
              ELSE urgency
            END,
            CASE difficulty
              WHEN '중상' THEN '상'
              WHEN '중하' THEN '하'
              ELSE difficulty
            END,
            created_at, updated_at
          FROM work_logs
        `);
        this.db!.exec('DROP TABLE work_logs');
        this.db!.exec('ALTER TABLE work_logs_new RENAME TO work_logs');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date)');
        console.log('[DB] work_logs urgency/difficulty CHECK 제약 마이그레이션 완료');
      }
    } catch (e: unknown) {
      console.warn('[DB] work_logs CHECK 마이그레이션:', e instanceof Error ? e.message : String(e));
    }
    // categories: parent_id 컬럼 (구 스키마 호환)
    try {
      const tableInfo = this.db!.prepare("PRAGMA table_info(categories)").all() as { name: string }[];
      const hasParentId = tableInfo.some(c => c.name === 'parent_id');
      if (!hasParentId) {
        try {
          this.db!.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)');
        } catch (alterErr) {
          // ALTER 실패 시 테이블 재생성 (구 스키마 DB에서 parent_id 추가 불가 시)
          this.db!.exec('DROP TABLE IF EXISTS categories');
          this.db!.exec(`
            CREATE TABLE categories (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              parent_id INTEGER,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now')),
              FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
            )
          `);
          this.db!.exec('CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)');
        }
      }
    } catch (_) { /* already migrated */ }
    try {
      const wlInfo = this.db!.prepare("PRAGMA table_info(work_logs)").all() as { name: string }[];
      if (!wlInfo.some(c => c.name === 'issues')) {
        this.db!.exec('ALTER TABLE work_logs ADD COLUMN issues TEXT');
      }
    } catch (_) { /* already migrated */ }
    try {
      const wlInfo = this.db!.prepare("PRAGMA table_info(work_logs)").all() as { name: string }[];
      if (!wlInfo.some(c => c.name === 'task_code')) {
        this.db!.exec('ALTER TABLE work_logs ADD COLUMN task_code TEXT');
      }
    } catch (_) { /* already migrated */ }
    // urgency/difficulty -> work_indicator 마이그레이션
    try {
      const wlInfo = this.db!.prepare("PRAGMA table_info(work_logs)").all() as { name: string }[];
      const hasWorkIndicator = wlInfo.some(c => c.name === 'work_indicator');
      const hasUrgency = wlInfo.some(c => c.name === 'urgency');
      if (hasUrgency || !hasWorkIndicator) {
        this.db!.exec(`
          CREATE TABLE work_logs_new (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            issues TEXT,
            duration REAL NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
            work_indicator TEXT NOT NULL DEFAULT '기타/행정' CHECK (work_indicator IN ('R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정')),
            task_code TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
          )
        `);
        const hasIssues = wlInfo.some(c => c.name === 'issues');
        const hasTaskCode = wlInfo.some(c => c.name === 'task_code');
        const selIssues = hasIssues ? 'issues' : 'NULL';
        const selTaskCode = hasTaskCode ? 'task_code' : 'NULL';
        const selWorkIndicator = hasWorkIndicator ? "COALESCE(work_indicator, '기타')" : "'기타'";
        this.db!.exec(`
          INSERT INTO work_logs_new SELECT
            id, member_id, date, category, content, ${selIssues}, duration, count, status,
            ${selWorkIndicator}, ${selTaskCode}, created_at, updated_at
          FROM work_logs
        `);
        this.db!.exec('DROP TABLE work_logs');
        this.db!.exec('ALTER TABLE work_logs_new RENAME TO work_logs');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date)');
        console.log('[DB] work_indicator 마이그레이션 완료');
      }
    } catch (e: unknown) {
      console.warn('[DB] work_indicator 마이그레이션:', e instanceof Error ? e.message : String(e));
    }
    // work_indicator 구값 -> 신규값 마이그레이션 (루틴->R&R/루틴업무 등)
    try {
      const oldVals = ['루틴', '대응', '성장', '지원', '기타'];
      const newVals = ['R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정'];
      const anyOld = this.db!.prepare("SELECT 1 FROM work_logs WHERE work_indicator IN ('루틴','대응','성장','지원','기타') LIMIT 1").get();
      if (anyOld) {
        this.db!.exec(`
          CREATE TABLE work_logs_new (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            issues TEXT,
            duration REAL NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
            work_indicator TEXT NOT NULL DEFAULT '기타/행정' CHECK (work_indicator IN ('R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정')),
            task_code TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
          )
        `);
        const mapCase = oldVals.map((o, i) => `WHEN work_indicator='${o}' THEN '${newVals[i]}'`).join(' ');
        this.db!.exec(`
          INSERT INTO work_logs_new SELECT
            id, member_id, date, category, content, issues, duration, count, status,
            CASE ${mapCase} ELSE '기타/행정' END, task_code, created_at, updated_at
          FROM work_logs
        `);
        this.db!.exec('DROP TABLE work_logs');
        this.db!.exec('ALTER TABLE work_logs_new RENAME TO work_logs');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date)');
        console.log('[DB] work_indicator 구값->신규값 마이그레이션 완료');
      }
    } catch (e: unknown) {
      console.warn('[DB] work_indicator 구값 마이그레이션:', e instanceof Error ? e.message : String(e));
    }

    // R&R/고유업무 → R&R/루틴업무 (기존 DB CHECK·데이터 정합)
    try {
      const row = this.db!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='work_logs'").get() as
        | { sql: string | null }
        | undefined;
      const ddl = row?.sql ?? '';
      if (ddl.includes("'R&R/고유업무'") && !ddl.includes("'R&R/루틴업무'")) {
        this.db!.exec(`
          CREATE TABLE work_logs_mig_rr (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            issues TEXT,
            duration REAL NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
            work_indicator TEXT NOT NULL DEFAULT '기타/행정' CHECK (work_indicator IN ('R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정')),
            task_code TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
          )
        `);
        this.db!.exec(`
          INSERT INTO work_logs_mig_rr
          SELECT
            id, member_id, date, category, content, issues, duration, count, status,
            CASE WHEN work_indicator = 'R&R/고유업무' THEN 'R&R/루틴업무' ELSE work_indicator END,
            task_code, created_at, updated_at
          FROM work_logs
        `);
        this.db!.exec('DROP TABLE work_logs');
        this.db!.exec('ALTER TABLE work_logs_mig_rr RENAME TO work_logs');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date)');
        console.log('[DB] work_indicator R&R/루틴업무 라벨 마이그레이션 완료');
      }
    } catch (e: unknown) {
      console.warn('[DB] R&R/루틴업무 라벨 마이그레이션:', e instanceof Error ? e.message : String(e));
    }

    // teams 테이블 + members.team_id
    try {
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_teams_sort ON teams(sort_order);
      `);
      const memberCols = this.db!.prepare('PRAGMA table_info(members)').all() as { name: string }[];
      if (!memberCols.some(c => c.name === 'team_id')) {
        this.db!.exec('ALTER TABLE members ADD COLUMN team_id TEXT REFERENCES teams(id)');
      }
      this.ensureDefaultTeams();
      this.db!.prepare('UPDATE members SET team_id = ? WHERE team_id IS NULL OR team_id = ?').run(TEAM_QG2_ID, '');
    } catch (e: unknown) {
      console.warn('[DB] teams 마이그레이션:', e instanceof Error ? e.message : String(e));
    }

    try {
      const memberColsEmp = this.db!.prepare('PRAGMA table_info(members)').all() as { name: string }[];
      if (!memberColsEmp.some((c) => c.name === 'employee_no')) {
        this.db!.exec('ALTER TABLE members ADD COLUMN employee_no TEXT');
      }
    } catch (e: unknown) {
      console.warn('[DB] members employee_no 마이그레이션:', e instanceof Error ? e.message : String(e));
    }

    try {
      const memberColsStatus = this.db!.prepare('PRAGMA table_info(members)').all() as { name: string }[];
      if (!memberColsStatus.some((c) => c.name === 'status_message')) {
        this.db!.exec('ALTER TABLE members ADD COLUMN status_message TEXT');
      }
    } catch (e: unknown) {
      console.warn('[DB] members status_message 마이그레이션:', e instanceof Error ? e.message : String(e));
    }

    try {
      const tc = this.db!.prepare('PRAGMA table_info(teams)').all() as { name: string }[];
      if (!tc.some((c) => c.name === 'admin_login_id')) {
        this.db!.exec('ALTER TABLE teams ADD COLUMN admin_login_id TEXT');
      }
      if (!tc.some((c) => c.name === 'admin_password_hash')) {
        this.db!.exec('ALTER TABLE teams ADD COLUMN admin_password_hash TEXT');
      }
      if (!tc.some((c) => c.name === 'admin_extra_json')) {
        this.db!.exec('ALTER TABLE teams ADD COLUMN admin_extra_json TEXT');
      }
      this.ensureMasterDefaults();
    } catch (e: unknown) {
      console.warn('[DB] teams admin / master:', e instanceof Error ? e.message : String(e));
    }

    // work_logs: duration·count 비음 제약(CHECK)
    try {
      const row = this.db!.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='work_logs'").get() as
        | { sql: string | null }
        | undefined;
      const ddl = row?.sql ?? '';
      if (!ddl.includes('duration >= 0') || !ddl.includes('count >= 0')) {
        this.db!.exec(`
          CREATE TABLE work_logs_nonneg_chk (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            date TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            issues TEXT,
            duration REAL NOT NULL CHECK (duration >= 0),
            count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
            status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
            work_indicator TEXT NOT NULL DEFAULT '기타/행정' CHECK (work_indicator IN ('R&R/루틴업무', '현안대응', '품질고도화 과제', '조직운영관리', '기타/행정')),
            task_code TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
          )
        `);
        this.db!.exec(`
          INSERT INTO work_logs_nonneg_chk SELECT
            id,
            member_id,
            date,
            category,
            content,
            issues,
            MAX(0.0, ROUND(COALESCE(duration, 0), 4)),
            MAX(0, CAST(ABS(ROUND(COALESCE(count, 0))) AS INTEGER)),
            status,
            work_indicator,
            task_code,
            created_at,
            updated_at
          FROM work_logs
        `);
        this.db!.exec('DROP TABLE work_logs');
        this.db!.exec('ALTER TABLE work_logs_nonneg_chk RENAME TO work_logs');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category)');
        this.db!.exec('CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date)');
        console.log('[DB] work_logs duration/count CHECK 마이그레이션 완료');
      }
    } catch (e: unknown) {
      console.warn('[DB] work_logs nonnegative CHECK:', e instanceof Error ? e.message : String(e));
    }
  }

  private ensureMasterDefaults(): void {
    const hasId = this.db!.prepare('SELECT 1 FROM app_settings WHERE key = ?').get('master_login_id');
    if (!hasId) {
      this.db!.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(
        'master_login_id',
        '201521570'
      );
    }
    const hasPw = this.db!.prepare('SELECT 1 FROM app_settings WHERE key = ?').get('master_password_hash');
    if (!hasPw) {
      this.db!.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(
        'master_password_hash',
        hashPassword('1111')
      );
    }
  }

  private ensureDefaultTeams(): void {
    const count = (this.db!.prepare('SELECT COUNT(*) as c FROM teams').get() as { c: number }).c;
    if (count === 0) {
      const ins = this.db!.prepare('INSERT INTO teams (id, name, sort_order) VALUES (?, ?, ?)');
      for (const t of DEFAULT_TEAMS_SEED) {
        ins.run(t.id, t.name, t.sortOrder);
      }
    }
  }

  private initializeCategories(): void {
    const count = this.db!.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
    if (count.count === 0) {
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
      const insert = this.db!.prepare('INSERT INTO categories (name, parent_id, sort_order) VALUES (?, ?, ?)');
      const parentIds = new Map<string, number>();
      roots.forEach((name, i) => {
        const res = insert.run(name, null, i + 1);
        parentIds.set(name, (res as { lastInsertRowid: number }).lastInsertRowid);
      });
      children.forEach((c, i) => {
        const pid = parentIds.get(c.parent);
        insert.run(c.child, pid ?? null, i + 1);
      });
    }
  }

  /** exe 실행 시 바로 보이도록 내장 샘플 데이터 삽입 (품질보증2팀만, 1팀은 빈 팀) */
  private async seedSampleData(): Promise<void> {
    const { members, logs, categories } = generateSampleData();
    const teams: WorkTeam[] = DEFAULT_TEAMS_SEED.map(t => ({ id: t.id, name: t.name, sortOrder: t.sortOrder }));
    await this.importData({ teams, members, logs, categories });
    console.log('[DB] 내장 샘플 데이터 삽입 완료');
  }

  getConfig() {
    return { ...this.config };
  }

  async setDbPath(newPath: string): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.dbPath = newPath;
    saveDbPath(newPath);
    await this.initialize();
  }

  isConnected(): boolean {
    return this.config.isConnected && this.db !== null;
  }

  async getTeams(): Promise<WorkTeam[]> {
    const stmt = this.db!.prepare(`
      SELECT id, name, sort_order as sortOrder,
        admin_login_id as adminLoginId,
        CASE WHEN admin_password_hash IS NOT NULL AND admin_password_hash != '' THEN 1 ELSE 0 END as hasPw,
        admin_extra_json as adminExtraJson
      FROM teams ORDER BY sort_order
    `);
    const rows = stmt.all() as {
      id: string;
      name: string;
      sortOrder: number;
      adminLoginId: string | null;
      hasPw: number;
      adminExtraJson: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      adminLoginId: r.adminLoginId ?? null,
      hasAdminPassword: r.hasPw === 1,
      extraAdminAccounts: toPreviewExtras(parseStoredAdminExtras(r.adminExtraJson)),
    }));
  }

  async insertTeam(name: string): Promise<WorkTeam> {
    const id = crypto.randomUUID();
    const row = this.db!.prepare('SELECT MAX(sort_order) as m FROM teams').get() as { m: number | null };
    const sortOrder = (row?.m ?? 0) + 1;
    this.db!.prepare('INSERT INTO teams (id, name, sort_order) VALUES (?, ?, ?)').run(id, name, sortOrder);
    return { id, name, sortOrder, adminLoginId: null, hasAdminPassword: false };
  }

  async verifyMasterLogin(loginId: string, password: string): Promise<boolean> {
    const idRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('master_login_id') as
      | { value: string }
      | undefined;
    if (!idRow || idRow.value !== loginId) return false;
    const pw = (password ?? '').trim();
    if (pw === '') return true;
    const pwRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('master_password_hash') as
      | { value: string }
      | undefined;
    if (!pwRow) return false;
    return pwRow.value === hashPassword(password);
  }

  async verifyTeamAdmin(teamId: string, loginId: string, password: string): Promise<boolean> {
    const hp = hashPassword(password);
    if (teamId === GLOBAL_TEAM_ADMIN_SCOPE_ID) {
      const idRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_login_id') as
        | { value: string }
        | undefined;
      const pwRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_password_hash') as
        | { value: string }
        | undefined;
      if (idRow?.value?.trim() && pwRow?.value && idRow.value === loginId && pwRow.value === hp) return true;
      const extraRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_extra_json') as
        | { value: string }
        | undefined;
      for (const e of parseStoredAdminExtras(extraRow?.value ?? null)) {
        if (e.loginId === loginId && e.passwordHash === hp) return true;
      }
      return false;
    }
    const row = this.db!.prepare(
      'SELECT admin_login_id, admin_password_hash, admin_extra_json FROM teams WHERE id = ?'
    ).get(teamId) as
      | { admin_login_id: string | null; admin_password_hash: string | null; admin_extra_json: string | null }
      | undefined;
    if (row?.admin_login_id && row.admin_password_hash && row.admin_login_id === loginId && row.admin_password_hash === hp)
      return true;
    for (const e of parseStoredAdminExtras(row?.admin_extra_json ?? null)) {
      if (e.loginId === loginId && e.passwordHash === hp) return true;
    }
    return false;
  }

  private deleteTeamCascade(teamId: string): void {
    const mids = this.db!.prepare('SELECT id FROM members WHERE team_id = ?').all(teamId) as { id: string }[];
    for (const m of mids) {
      this.db!.prepare('DELETE FROM work_logs WHERE member_id = ?').run(m.id);
      this.db!.prepare('DELETE FROM members WHERE id = ?').run(m.id);
    }
    this.db!.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  }

  async saveAdminTeamsTransaction(payload: {
    teams: Array<{
      id: string;
      name: string;
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
    for (const t of payload.teams) {
      if (t.extraAdmins !== undefined) {
        const oldRow = this.db!.prepare('SELECT admin_extra_json FROM teams WHERE id = ?').get(t.id) as
          | { admin_extra_json?: string | null }
          | undefined;
        const merged = await mergeAdminExtrasOnSave(oldRow?.admin_extra_json ?? null, t.extraAdmins, (pw) =>
          Promise.resolve(hashPassword(pw))
        );
        teamExtraMerged.set(t.id, serializeAdminExtras(merged));
      }
    }
    let globalExtraPrecomputed: string | undefined;
    if (payload.globalTeamAdmin && payload.globalTeamAdmin.extraAdmins !== undefined) {
      const oldRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_extra_json') as
        | { value: string }
        | undefined;
      const merged = await mergeAdminExtrasOnSave(oldRow?.value ?? null, payload.globalTeamAdmin.extraAdmins, (pw) =>
        Promise.resolve(hashPassword(pw))
      );
      globalExtraPrecomputed = serializeAdminExtras(merged);
    }

    const tx = this.db!.transaction(() => {
      for (const tid of payload.deletedTeamIds) {
        this.deleteTeamCascade(tid);
      }
      for (const t of payload.teams) {
        const exists = this.db!.prepare('SELECT 1 FROM teams WHERE id = ?').get(t.id);
        const pw = t.passwordPlain;
        const hasNewPw = pw !== undefined && pw !== null && String(pw).length > 0;
        const extraJson = teamExtraMerged.get(t.id);

        if (exists) {
          if (hasNewPw) {
            if (extraJson !== undefined) {
              this.db!
                .prepare(
                  `UPDATE teams SET name = ?, sort_order = ?, admin_login_id = ?, admin_password_hash = ?, admin_extra_json = ? WHERE id = ?`
                )
                .run(t.name, t.sortOrder, t.adminLoginId || null, hashPassword(String(pw)), extraJson, t.id);
            } else {
              this.db!
                .prepare(
                  `UPDATE teams SET name = ?, sort_order = ?, admin_login_id = ?, admin_password_hash = ? WHERE id = ?`
                )
                .run(t.name, t.sortOrder, t.adminLoginId || null, hashPassword(String(pw)), t.id);
            }
          } else if (extraJson !== undefined) {
            this.db!
              .prepare(
                `UPDATE teams SET name = ?, sort_order = ?, admin_login_id = ?, admin_extra_json = ? WHERE id = ?`
              )
              .run(t.name, t.sortOrder, t.adminLoginId || null, extraJson, t.id);
          } else {
            this.db!
              .prepare(`UPDATE teams SET name = ?, sort_order = ?, admin_login_id = ? WHERE id = ?`)
              .run(t.name, t.sortOrder, t.adminLoginId || null, t.id);
          }
        } else {
          const h = hasNewPw ? hashPassword(String(pw)) : null;
          const insExtra = extraJson !== undefined ? extraJson : null;
          this.db!
            .prepare(
              `INSERT INTO teams (id, name, sort_order, admin_login_id, admin_password_hash, admin_extra_json) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(t.id, t.name, t.sortOrder, t.adminLoginId || null, h, insExtra);
        }
      }
      if (payload.globalTeamAdmin !== undefined) {
        this.applyGlobalTeamAdminSave(payload.globalTeamAdmin, globalExtraPrecomputed);
      }
      if (payload.workRecordStartDate !== undefined) {
        const raw = (payload.workRecordStartDate ?? '').trim();
        const v = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
        this.db!
          .prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`)
          .run('global_work_record_start_date', v);
      }
    });
    tx();
  }

  async changeAdminPasswordSelf(params: ChangeAdminPasswordSelfParams): Promise<void> {
    const cur = params.currentPassword;
    const neu = params.newPassword;
    if (!neu?.length) {
      throw new Error('새 비밀번호를 입력해 주세요.');
    }
    if (params.scope === 'master') {
      const idRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('master_login_id') as
        | { value: string }
        | undefined;
      const pwRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('master_password_hash') as
        | { value: string }
        | undefined;
      if (!idRow?.value?.trim() || !pwRow?.value) {
        throw new Error('마스터 계정이 설정되지 않았습니다.');
      }
      if (pwRow.value !== hashPassword(cur)) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      this.db!
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        )
        .run('master_password_hash', hashPassword(neu));
      return;
    }
    if (params.scope === 'global') {
      const target = (params.adminLoginId ?? '').trim();
      const idRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_login_id') as
        | { value: string }
        | undefined;
      const pwRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_password_hash') as
        | { value: string }
        | undefined;
      const extraRow = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?').get('global_team_admin_extra_json') as
        | { value: string }
        | undefined;
      const extras = parseStoredAdminExtras(extraRow?.value ?? null);
      const curH = hashPassword(cur);
      const neuH = hashPassword(neu);
      const primaryId = (idRow?.value ?? '').trim();

      if (!target || target === primaryId) {
        if (!primaryId || !pwRow?.value) {
          throw new Error('전체팀 관리자가 설정되지 않았습니다.');
        }
        if (pwRow.value !== curH) {
          throw new Error('현재 비밀번호가 올바르지 않습니다.');
        }
        this.db!
          .prepare(
            `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
          )
          .run('global_team_admin_password_hash', neuH);
        return;
      }
      const idx = extras.findIndex((e) => e.loginId === target);
      if (idx < 0) {
        throw new Error('관리자 계정을 찾을 수 없습니다.');
      }
      if (extras[idx].passwordHash !== curH) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      extras[idx] = { loginId: target, passwordHash: neuH };
      const ins = this.db!.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      );
      ins.run('global_team_admin_extra_json', serializeAdminExtras(extras));
      return;
    }
    const teamId = params.teamId;
    const row = this.db!.prepare(
      'SELECT admin_login_id, admin_password_hash, admin_extra_json FROM teams WHERE id = ?'
    ).get(teamId) as
      | { admin_login_id: string | null; admin_password_hash: string | null; admin_extra_json: string | null }
      | undefined;
    const target = (params.adminLoginId ?? '').trim();
    const primaryId = (row?.admin_login_id ?? '').trim();
    const curH = hashPassword(cur);
    const neuH = hashPassword(neu);

    if (!target || target === primaryId) {
      if (!primaryId || !row?.admin_password_hash) {
        throw new Error('팀 관리자가 설정되지 않았습니다. 마스터 관리자에게 사번 등록을 요청하세요.');
      }
      if (row.admin_password_hash !== curH) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }
      this.db!.prepare('UPDATE teams SET admin_password_hash = ? WHERE id = ?').run(neuH, teamId);
      return;
    }
    const extras = parseStoredAdminExtras(row?.admin_extra_json ?? null);
    const idx = extras.findIndex((e) => e.loginId === target);
    if (idx < 0) {
      throw new Error('관리자 계정을 찾을 수 없습니다.');
    }
    if (extras[idx].passwordHash !== curH) {
      throw new Error('현재 비밀번호가 올바르지 않습니다.');
    }
    extras[idx] = { loginId: target, passwordHash: neuH };
    this.db!.prepare('UPDATE teams SET admin_extra_json = ? WHERE id = ?').run(serializeAdminExtras(extras), teamId);
  }

  private applyGlobalTeamAdminSave(g: GlobalTeamAdminSavePayload, precomputedExtraJson?: string): void {
    const ins = this.db!.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    );
    if (g === null) {
      this.db!.prepare('DELETE FROM app_settings WHERE key IN (?, ?, ?)').run(
        'global_team_admin_login_id',
        'global_team_admin_password_hash',
        'global_team_admin_extra_json'
      );
      return;
    }
    const login = (g.adminLoginId ?? '').trim();
    if (!login) {
      this.db!.prepare('DELETE FROM app_settings WHERE key IN (?, ?, ?)').run(
        'global_team_admin_login_id',
        'global_team_admin_password_hash',
        'global_team_admin_extra_json'
      );
      return;
    }
    ins.run('global_team_admin_login_id', login);
    const pw = g.passwordPlain;
    const hasNewPw = pw !== undefined && pw !== null && String(pw).length > 0;
    if (hasNewPw) {
      ins.run('global_team_admin_password_hash', hashPassword(String(pw)));
    }
    if (precomputedExtraJson !== undefined) {
      ins.run('global_team_admin_extra_json', precomputedExtraJson);
    }
  }

  async getAllMembers(): Promise<TeamMember[]> {
    const stmt = this.db!.prepare(
      'SELECT id, name, role, avatar, status_message as statusMessage, team_id as teamId, employee_no as employeeNo FROM members ORDER BY name'
    );
    const rows = stmt.all() as {
      id: string;
      name: string;
      role: string;
      avatar?: string;
      statusMessage: string | null;
      teamId: string | null;
      employeeNo: string | null;
    }[];
    return rows.map((r) => ({
      ...r,
      avatar: r.avatar || undefined,
      statusMessage: r.statusMessage?.trim() ? r.statusMessage.trim() : undefined,
      teamId: r.teamId || '',
      employeeNo: r.employeeNo ?? undefined,
    }));
  }

  async getMembersByTeam(teamId: string): Promise<TeamMember[]> {
    const stmt = this.db!.prepare(
      'SELECT id, name, role, avatar, status_message as statusMessage, team_id as teamId, employee_no as employeeNo FROM members WHERE team_id = ? ORDER BY name'
    );
    const rows = stmt.all(teamId) as {
      id: string;
      name: string;
      role: string;
      avatar?: string;
      statusMessage: string | null;
      teamId: string | null;
      employeeNo: string | null;
    }[];
    return rows.map((r) => ({
      ...r,
      avatar: r.avatar || undefined,
      statusMessage: r.statusMessage?.trim() ? r.statusMessage.trim() : undefined,
      teamId: r.teamId || teamId,
      employeeNo: r.employeeNo ?? undefined,
    }));
  }

  async getMemberById(id: string): Promise<TeamMember | null> {
    const stmt = this.db!.prepare(
      'SELECT id, name, role, avatar, status_message as statusMessage, team_id as teamId, employee_no as employeeNo FROM members WHERE id = ?'
    );
    const row = stmt.get(id) as
      | {
          id: string;
          name: string;
          role: string;
          avatar?: string;
          statusMessage: string | null;
          teamId: string | null;
          employeeNo: string | null;
        }
      | undefined;
    return row
      ? {
          ...row,
          avatar: row.avatar || undefined,
          statusMessage: row.statusMessage?.trim() ? row.statusMessage.trim() : undefined,
          teamId: row.teamId || '',
          employeeNo: row.employeeNo ?? undefined,
        }
      : null;
  }

  async insertMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember> {
    const id = crypto.randomUUID();
    const stmt = this.db!.prepare(
      'INSERT INTO members (id, name, role, avatar, status_message, team_id, employee_no) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    stmt.run(
      id,
      member.name,
      member.role,
      member.avatar || null,
      member.statusMessage?.trim() ? member.statusMessage.trim() : null,
      member.teamId,
      member.employeeNo?.trim() ? member.employeeNo.trim() : null
    );
    return { id, ...member, employeeNo: member.employeeNo?.trim() || undefined };
  }

  async updateMember(id: string, updates: Partial<TeamMember>): Promise<void> {
    const current = await this.getMemberById(id);
    if (!current) return;
    const updated = { ...current, ...updates };
    const st = updated.statusMessage;
    const statusRaw = st != null && String(st).trim() !== '' ? String(st).trim() : null;
    const stmt = this.db!.prepare(
      "UPDATE members SET name = ?, role = ?, avatar = ?, status_message = ?, team_id = ?, employee_no = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(
      updated.name,
      updated.role,
      updated.avatar || null,
      statusRaw || null,
      updated.teamId,
      updated.employeeNo?.trim() ? updated.employeeNo.trim() : null,
      id
    );
  }

  async deleteMember(id: string): Promise<void> {
    this.db!.prepare('DELETE FROM members WHERE id = ?').run(id);
  }

  async getAllLogs(): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, issues, duration, count, status,
             work_indicator as workIndicator, task_code as taskCode,
             created_at as createdAt, updated_at as updatedAt 
      FROM work_logs ORDER BY date DESC, created_at DESC
    `);
    return stmt.all() as WorkLog[];
  }

  async getLogsByMemberId(memberId: string): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, issues, duration, count, status,
             work_indicator as workIndicator, task_code as taskCode,
             created_at as createdAt, updated_at as updatedAt
      FROM work_logs WHERE member_id = ? ORDER BY date DESC, created_at DESC
    `);
    return stmt.all(memberId) as WorkLog[];
  }

  async getLogsByDateRange(startDate: string, endDate: string): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, issues, duration, count, status,
             work_indicator as workIndicator, task_code as taskCode,
             created_at as createdAt, updated_at as updatedAt
      FROM work_logs
      WHERE strftime('%Y-%m-%d', date) >= ? AND strftime('%Y-%m-%d', date) <= ?
      ORDER BY date DESC
    `);
    return stmt.all(startDate, endDate) as WorkLog[];
  }

  async getLogsByTeam(teamId: string): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT w.id, w.member_id as memberId, w.date, w.category, w.content, w.issues, w.duration, w.count, w.status,
             w.work_indicator as workIndicator, w.task_code as taskCode,
             w.created_at as createdAt, w.updated_at as updatedAt
      FROM work_logs w
      INNER JOIN members m ON m.id = w.member_id
      WHERE m.team_id = ?
      ORDER BY w.date DESC, w.created_at DESC
    `);
    return stmt.all(teamId) as WorkLog[];
  }

  private getWorkLogById(id: string): WorkLog | null {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, issues, duration, count, status,
             work_indicator as workIndicator, task_code as taskCode,
             created_at as createdAt, updated_at as updatedAt
      FROM work_logs WHERE id = ?
    `);
    const r = stmt.get(id) as WorkLog | undefined;
    return r ?? null;
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
    const stmt = this.db!.prepare(`
      INSERT INTO work_logs (id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
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
      now
    );
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
  }

  async updateLog(id: string, updates: Partial<WorkLog>, requesterMemberId?: string | null): Promise<void> {
    if (requesterMemberId == null || requesterMemberId === '') {
      throw new Error('업무 수정 시 작성자 검증 정보가 필요합니다.');
    }
    const current = this.getWorkLogById(id);
    if (!current) {
      throw new Error(`업무 기록을 찾을 수 없습니다. (id=${id})`);
    }
    if (current.memberId !== requesterMemberId) {
      throw new Error('수정: 본인 소유 업무가 아닙니다.');
    }
    const updated = this.mergePersistedLog(current, updates);
    const stmt = this.db!.prepare(`
      UPDATE work_logs SET member_id = ?, date = ?, category = ?, content = ?, issues = ?,
             duration = ?, count = ?, status = ?, work_indicator = ?, task_code = ?,
             updated_at = datetime('now')
      WHERE id = ? AND member_id = ?
    `);
    const res = stmt.run(
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
      requesterMemberId
    );
    if (res.changes !== 1) {
      throw new Error(`업무 수정에 실패했습니다. (id=${id})`);
    }
  }

  async deleteLog(id: string, requesterMemberId?: string | null): Promise<void> {
    if (requesterMemberId == null || requesterMemberId === '') {
      throw new Error('업무 삭제 시 작성자 검증 정보가 필요합니다.');
    }
    const row = this.getWorkLogById(id);
    if (!row) {
      throw new Error(`삭제할 업무를 찾을 수 없습니다. (id=${id})`);
    }
    if (row.memberId !== requesterMemberId) {
      throw new Error('삭제: 본인 소유 업무가 아닙니다.');
    }
    const res = this.db!.prepare('DELETE FROM work_logs WHERE id = ? AND member_id = ?').run(id, requesterMemberId);
    if (res.changes !== 1) {
      throw new Error(`업무 삭제에 실패했습니다. (id=${id})`);
    }
  }

  async saveLogsBatch(payload: SaveLogsBatchPayload): Promise<void> {
    const { requesterMemberId, deletedLogIds, updatedLogs, newLogs } = payload;
    if (!requesterMemberId) {
      throw new Error('일괄 저장에는 작성자(member) id가 필요합니다.');
    }
    const inner = (): void => {
      const delStmt = this.db!.prepare('DELETE FROM work_logs WHERE id = ? AND member_id = ?');
      for (const delId of deletedLogIds) {
        const row = this.getWorkLogById(delId);
        if (!row) throw new Error(`삭제할 업무를 찾을 수 없습니다. (id=${delId})`);
        if (row.memberId !== requesterMemberId) throw new Error('삭제: 본인 소유 업무가 아닙니다.');
        const dr = delStmt.run(delId, requesterMemberId);
        if (dr.changes !== 1) throw new Error(`삭제 처리 실패 (id=${delId})`);
      }

      const updStmt = this.db!.prepare(`
        UPDATE work_logs SET member_id = ?, date = ?, category = ?, content = ?, issues = ?,
               duration = ?, count = ?, status = ?, work_indicator = ?, task_code = ?,
               updated_at = datetime('now')
        WHERE id = ? AND member_id = ?
      `);
      for (const { id: uid, updates } of updatedLogs) {
        if (!updates || Object.keys(updates).length === 0) continue;
        const cur = this.getWorkLogById(uid);
        if (!cur) throw new Error(`업무 기록을 찾을 수 없습니다. (id=${uid})`);
        if (cur.memberId !== requesterMemberId) throw new Error('수정: 본인 소유 업무가 아닙니다.');
        const merged = this.mergePersistedLog(cur, updates);
        const ur = updStmt.run(
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
          requesterMemberId
        );
        if (ur.changes !== 1) throw new Error(`업무 수정에 실패했습니다. (id=${uid})`);
      }

      const insStmt = this.db!.prepare(`
        INSERT INTO work_logs (id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const log of newLogs) {
        if (log.memberId !== requesterMemberId) {
          throw new Error('추가: 다른 멤버 명의의 업무는 저장할 수 없습니다.');
        }
        const nid = crypto.randomUUID();
        const now = new Date().toISOString();
        const dateStr = ensureDateYYYYMMDD(log.date);
        const dur = normalizeDurationForStorage(log.duration);
        const cnt = normalizeCountForStorage(log.count);
        const wi = log.workIndicator || '기타/행정';
        insStmt.run(
          nid,
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
          now
        );
      }
    };
    this.db!.transaction(inner)();
  }

  async deleteLogsByMemberId(memberId: string): Promise<void> {
    this.db!.prepare('DELETE FROM work_logs WHERE member_id = ?').run(memberId);
  }

  async getCategoriesTree(): Promise<Category[]> {
    const stmt = this.db!.prepare(
      'SELECT id, name, parent_id as parentId, sort_order as sortOrder FROM categories ORDER BY sort_order'
    );
    return stmt.all() as Category[];
  }

  async saveCategoriesTree(categories: Category[]): Promise<void> {
    const inner = (): void => {
      this.db!.prepare('DELETE FROM categories').run();
      const insert = this.db!.prepare('INSERT INTO categories (name, parent_id, sort_order) VALUES (?, ?, ?)');
      const idMap = new Map<number, number>();
      const roots = categories.filter((c) => c.parentId == null).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const children = categories
        .filter((c) => c.parentId != null)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      roots.forEach((cat, i) => {
        const res = insert.run(cat.name, null, i + 1);
        idMap.set(cat.id, (res as { lastInsertRowid: number }).lastInsertRowid);
      });
      children.forEach((cat, i) => {
        const newParentId = idMap.get(cat.parentId!);
        insert.run(cat.name, newParentId ?? null, i + 1);
      });
    };
    this.db!.transaction(inner)();
  }


  async getAllCategories(): Promise<string[]> {
    const tree = await this.getCategoriesTree();
    const byId = new Map<number, Category>();
    tree.forEach(c => byId.set(c.id, c));
    return tree
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map(c => {
        if (c.parentId == null) return c.name;
        const parent = byId.get(c.parentId);
        return parent ? `${parent.name} > ${c.name}` : c.name;
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
    const stmt = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const stmt = this.db!.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    stmt.run(key, value);
  }

  async clearAllData(): Promise<void> {
    this.db!.prepare('DELETE FROM work_logs').run();
    this.db!.prepare('DELETE FROM members').run();
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
    const adminSnap = new Map<string, TeamAdminSnap>();
    try {
      const rows = this.db!.prepare('SELECT id, admin_login_id, admin_password_hash, admin_extra_json FROM teams').all() as Array<{
        id: string;
        admin_login_id: string | null;
        admin_password_hash: string | null;
        admin_extra_json: string | null;
      }>;
      for (const r of rows) {
        adminSnap.set(r.id, {
          admin_login_id: r.admin_login_id ?? null,
          admin_password_hash: r.admin_password_hash ?? null,
          admin_extra_json: r.admin_extra_json ?? null,
        });
      }
    } catch {
      /* teams 테이블 없음 등 */
    }

    await this.clearAllData();
    if (data.teams && data.teams.length > 0) {
      this.db!.prepare('DELETE FROM teams').run();
      const insTeam = this.db!.prepare(
        'INSERT INTO teams (id, name, sort_order, admin_login_id, admin_password_hash, admin_extra_json) VALUES (?, ?, ?, ?, ?, ?)'
      );
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
        insTeam.run(t.id, t.name, t.sortOrder, adminId, adminHash, adminExtra);
      }
    } else {
      this.ensureDefaultTeams();
    }
    const insertMember = this.db!.prepare(
      'INSERT INTO members (id, name, role, avatar, status_message, team_id, employee_no) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const m of data.members) {
      const tid = m.teamId || TEAM_QG2_ID;
      insertMember.run(
        m.id,
        m.name,
        m.role,
        m.avatar || null,
        m.statusMessage?.trim() ? m.statusMessage.trim() : null,
        tid,
        m.employeeNo?.trim() ? m.employeeNo.trim() : null
      );
    }
    const insertLog = this.db!.prepare(`
      INSERT INTO work_logs (id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of data.logs) {
      const dur = clampDurationForImport(l.duration);
      const cnt = clampCountForImport(l.count);
      const wi = l.workIndicator || '기타/행정';
      insertLog.run(
        l.id,
        l.memberId,
        ensureDateYYYYMMDD(l.date),
        l.category,
        l.content,
        l.issues ?? null,
        dur,
        cnt,
        l.status || '완료',
        wi,
        l.taskCode ?? null,
        l.createdAt,
        l.updatedAt
      );
    }
    await this.saveCategories(data.categories);
  }
}
