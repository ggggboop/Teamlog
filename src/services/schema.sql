-- =====================================================
-- Team Work Log - SQLite Schema
-- =====================================================
-- 대분류/소분류 계층 구조
-- =====================================================

-- 설정 테이블 (앱 설정 저장)
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 팀원 테이블
CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT,
    status_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 업무 기록 테이블
CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    duration REAL NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT '완료' CHECK (status IN ('완료', '진행중', '취소')),
    urgency TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- 카테고리 테이블 (Self-referencing: parent_id NULL = 대분류)
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(name, parent_id),
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_work_logs_status ON work_logs(status);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_status ON work_logs(member_id, status);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_id ON work_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(date);
CREATE INDEX IF NOT EXISTS idx_work_logs_category ON work_logs(category);
CREATE INDEX IF NOT EXISTS idx_work_logs_member_date ON work_logs(member_id, date);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
