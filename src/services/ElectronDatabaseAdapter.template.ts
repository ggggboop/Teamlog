/**
 * ElectronDatabaseAdapter - Electron 환경용 SQLite 어댑터 (템플릿)
 * 
 * 이 파일은 Electron으로 전환 시 better-sqlite3를 사용하여 구현합니다.
 * 웹 환경에서는 사용되지 않으며, 참조용 템플릿입니다.
 * 
 * 필요한 패키지:
 * - better-sqlite3
 * - @types/better-sqlite3 (개발용)
 * 
 * 설치: npm install better-sqlite3
 * 
 * Electron main process에서 이 어댑터를 초기화하고
 * preload script를 통해 renderer에 노출합니다.
 */

/*
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { IDatabaseAdapter, DatabaseConfig, DEFAULT_CATEGORIES } from './DatabaseAdapter';
import { TeamMember, WorkLog } from '@/types/workLog';

// 스키마 SQL (src/services/schema.sql 참조)
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    duration REAL NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    urgency TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date);
CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category);
`;

export class ElectronDatabaseAdapter implements IDatabaseAdapter {
  private db: Database.Database | null = null;
  private dbPath: string;
  private config: DatabaseConfig;

  constructor() {
    // 기본 경로: 사용자 데이터 폴더
    this.dbPath = path.join(app.getPath('userData'), 'team-worklog.db');
    this.config = {
      dbPath: this.dbPath,
      isConnected: false,
      adapterType: 'sqlite',
    };
  }

  async initialize(): Promise<void> {
    // 저장된 DB 경로가 있으면 사용
    const savedPath = this.loadSavedDbPath();
    if (savedPath) {
      this.dbPath = savedPath;
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    // 스키마 초기화
    this.db.exec(SCHEMA_SQL);
    
    // 기본 카테고리 삽입
    this.initializeCategories();
    
    this.config.isConnected = true;
    this.config.dbPath = this.dbPath;
  }

  private loadSavedDbPath(): string | null {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.dbPath || null;
    } catch {
      return null;
    }
  }

  private saveDbPath(dbPath: string): void {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ dbPath }));
  }

  private initializeCategories(): void {
    const count = this.db!.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
    if (count.count === 0) {
      const insert = this.db!.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
      DEFAULT_CATEGORIES.forEach((cat, index) => {
        insert.run(cat, index);
      });
    }
  }

  getConfig(): DatabaseConfig {
    return { ...this.config };
  }

  async setDbPath(newPath: string): Promise<void> {
    if (this.db) {
      this.db.close();
    }
    this.dbPath = newPath;
    this.saveDbPath(newPath);
    await this.initialize();
  }

  isConnected(): boolean {
    return this.config.isConnected && this.db !== null;
  }

  // ==================== Members ====================
  async getAllMembers(): Promise<TeamMember[]> {
    const stmt = this.db!.prepare('SELECT id, name, role, avatar FROM members ORDER BY name');
    return stmt.all() as TeamMember[];
  }

  async getMemberById(id: string): Promise<TeamMember | null> {
    const stmt = this.db!.prepare('SELECT id, name, role, avatar FROM members WHERE id = ?');
    return stmt.get(id) as TeamMember | null;
  }

  async insertMember(member: Omit<TeamMember, 'id'>): Promise<TeamMember> {
    const id = crypto.randomUUID();
    const stmt = this.db!.prepare('INSERT INTO members (id, name, role, avatar) VALUES (?, ?, ?, ?)');
    stmt.run(id, member.name, member.role, member.avatar || null);
    return { id, ...member };
  }

  async updateMember(id: string, updates: Partial<TeamMember>): Promise<void> {
    const current = await this.getMemberById(id);
    if (!current) return;
    
    const updated = { ...current, ...updates };
    const stmt = this.db!.prepare('UPDATE members SET name = ?, role = ?, avatar = ?, updated_at = datetime("now") WHERE id = ?');
    stmt.run(updated.name, updated.role, updated.avatar || null, id);
  }

  async deleteMember(id: string): Promise<void> {
    // CASCADE로 인해 관련 로그도 삭제됨
    const stmt = this.db!.prepare('DELETE FROM members WHERE id = ?');
    stmt.run(id);
  }

  // ==================== Work Logs ====================
  async getAllLogs(): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, duration, count, 
             urgency, difficulty, created_at as createdAt, updated_at as updatedAt 
      FROM work_logs ORDER BY date DESC, created_at DESC
    `);
    return stmt.all() as WorkLog[];
  }

  async getLogsByMemberId(memberId: string): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, duration, count,
             urgency, difficulty, created_at as createdAt, updated_at as updatedAt
      FROM work_logs WHERE member_id = ? ORDER BY date DESC, created_at DESC
    `);
    return stmt.all(memberId) as WorkLog[];
  }

  async getLogsByDateRange(startDate: string, endDate: string): Promise<WorkLog[]> {
    const stmt = this.db!.prepare(`
      SELECT id, member_id as memberId, date, category, content, duration, count,
             urgency, difficulty, created_at as createdAt, updated_at as updatedAt
      FROM work_logs WHERE date >= ? AND date <= ? ORDER BY date DESC
    `);
    return stmt.all(startDate, endDate) as WorkLog[];
  }

  async insertLog(log: Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkLog> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db!.prepare(`
      INSERT INTO work_logs (id, member_id, date, category, content, duration, count, urgency, difficulty, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, log.memberId, log.date, log.category, log.content, log.duration, log.count, log.urgency, log.difficulty, now, now);
    return { ...log, id, createdAt: now, updatedAt: now };
  }

  async updateLog(id: string, updates: Partial<WorkLog>): Promise<void> {
    const current = (await this.getAllLogs()).find(l => l.id === id);
    if (!current) return;
    
    const updated = { ...current, ...updates };
    const stmt = this.db!.prepare(`
      UPDATE work_logs SET member_id = ?, date = ?, category = ?, content = ?, 
             duration = ?, count = ?, urgency = ?, difficulty = ?, updated_at = datetime("now")
      WHERE id = ?
    `);
    stmt.run(updated.memberId, updated.date, updated.category, updated.content,
             updated.duration, updated.count, updated.urgency, updated.difficulty, id);
  }

  async deleteLog(id: string): Promise<void> {
    const stmt = this.db!.prepare('DELETE FROM work_logs WHERE id = ?');
    stmt.run(id);
  }

  async deleteLogsByMemberId(memberId: string): Promise<void> {
    const stmt = this.db!.prepare('DELETE FROM work_logs WHERE member_id = ?');
    stmt.run(memberId);
  }

  // ==================== Categories ====================
  async getAllCategories(): Promise<string[]> {
    const stmt = this.db!.prepare('SELECT name FROM categories ORDER BY sort_order');
    return (stmt.all() as { name: string }[]).map(r => r.name);
  }

  async saveCategories(categories: string[]): Promise<void> {
    this.db!.prepare('DELETE FROM categories').run();
    const insert = this.db!.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    categories.forEach((cat, index) => {
      insert.run(cat, index);
    });
  }

  // ==================== Settings ====================
  async getSetting(key: string): Promise<string | null> {
    const stmt = this.db!.prepare('SELECT value FROM app_settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const stmt = this.db!.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime("now"))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime("now")
    `);
    stmt.run(key, value, value);
  }

  // ==================== Data Management ====================
  async clearAllData(): Promise<void> {
    this.db!.prepare('DELETE FROM work_logs').run();
    this.db!.prepare('DELETE FROM members').run();
  }

  async exportData(): Promise<{ members: TeamMember[]; logs: WorkLog[]; categories: string[] }> {
    const [members, logs, categories] = await Promise.all([
      this.getAllMembers(),
      this.getAllLogs(),
      this.getAllCategories(),
    ]);
    return { members, logs, categories };
  }

  async importData(data: { members: TeamMember[]; logs: WorkLog[]; categories: string[] }): Promise<void> {
    await this.clearAllData();
    
    const insertMember = this.db!.prepare('INSERT INTO members (id, name, role, avatar) VALUES (?, ?, ?, ?)');
    for (const m of data.members) {
      insertMember.run(m.id, m.name, m.role, m.avatar || null);
    }
    
    const insertLog = this.db!.prepare(`
      INSERT INTO work_logs (id, member_id, date, category, content, duration, count, urgency, difficulty, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of data.logs) {
      insertLog.run(l.id, l.memberId, l.date, l.category, l.content, l.duration, l.count, l.urgency, l.difficulty, l.createdAt, l.updatedAt);
    }
    
    await this.saveCategories(data.categories);
  }
}
*/

// 이 파일은 템플릿입니다. Electron 전환 시 주석을 해제하고 사용하세요.
export {};
