import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { ElectronDatabaseAdapter, getPgConnectionSummary } from './database/ElectronDatabaseAdapter';
import {
  getPgSettingsForUi,
  mergeSavePgToSettings,
  mergePgConnectionFromDiskAndEnv,
  formatPgConnectionError,
  testPgConnectionRaw,
  type PgConnectionConfig,
} from './database/pgSettingsStorage';
import type { Category, WorkLog, TeamMember, WorkTeam } from '../src/types/workLog';
import type { SaveLogsBatchPayload } from '../src/services/DatabaseAdapter';
import type { ChangeAdminPasswordSelfParams } from '../src/constants/adminPasswordChange';
import { MIN_REQUIRED_VERSION_SETTING_KEY } from '../src/constants/versionPolicy';
import { versionLessThan } from '../src/utils/semverLite';

declare const __TEAMLOG_PACKAGE_VERSION__: string | undefined;

let mainWindow: BrowserWindow | null = null;
let dbAdapter: ElectronDatabaseAdapter | null = null;

function resolvePgFormToConfig(body: {
  host: string;
  port: number;
  user: string;
  database: string;
  password?: string;
}): PgConnectionConfig {
  const merged = mergePgConnectionFromDiskAndEnv();
  const pwd = (body.password ?? '').trim();
  return {
    host: (body.host ?? '').trim() || merged.host,
    port: Number.isFinite(Number(body.port)) ? Number(body.port) : merged.port,
    user: (body.user ?? '').trim() || merged.user,
    database: (body.database ?? '').trim() || merged.database,
    password: pwd !== '' ? pwd : merged.password,
  };
}

async function getAdapter(): Promise<ElectronDatabaseAdapter> {
  if (!dbAdapter) {
    const inst = new ElectronDatabaseAdapter();
    try {
      await inst.initialize();
      inst.onChange((payload) => {
        if (mainWindow) {
          mainWindow.webContents.send('db:changed', payload);
        }
      });
      dbAdapter = inst;
    } catch (e) {
      await inst.close().catch(() => {});
      throw e;
    }
  }
  return dbAdapter;
}

function resolveRuntimePackageVersion(): string {
  try {
    if (typeof __TEAMLOG_PACKAGE_VERSION__ === 'string' && __TEAMLOG_PACKAGE_VERSION__.length > 0) {
      return __TEAMLOG_PACKAGE_VERSION__;
    }
  } catch {
    /* 번들 define 없음 */
  }
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

const TEAMLOG_RUNTIME_PACKAGE_VERSION = resolveRuntimePackageVersion();

try {
  (globalThis as typeof globalThis & { TEAMLOG_APP_PACKAGE_VERSION?: string }).TEAMLOG_APP_PACKAGE_VERSION =
    TEAMLOG_RUNTIME_PACKAGE_VERSION;
} catch {
  /* ignore */
}
console.log('[Teamlog] 패키지 버전 (package.json):', TEAMLOG_RUNTIME_PACKAGE_VERSION);

// PostgreSQL: 연결 요약 표시(레거시 UI의 "DB 경로" 자리). 파일 선택 IPC는 미사용(null).
ipcMain.handle('db:getDbPath', () => {
  try {
    if (dbAdapter?.isConnected()) return dbAdapter.getConnectionSummary();
    return getPgConnectionSummary();
  } catch {
    return null;
  }
});

ipcMain.handle('db:selectDbFile', async () => {
  await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: 'PostgreSQL 연결',
    message: 'Teamlog는 PostgreSQL을 사용합니다.',
    detail: `userData/settings.json의 "pg" 항목(PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) 또는 환경 변수로 연결을 설정하세요.\n현재 설정 요약:\n${getPgConnectionSummary()}`,
  });
  return null;
});

ipcMain.handle('db:createNewDb', async () => {
  await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title: 'PostgreSQL',
    message: '데이터베이스와 사용자는 PostgreSQL 서버에서 미리 생성해야 합니다.',
    detail: `앱은 기존 DB에 스키마만 적용합니다.\n${getPgConnectionSummary()}`,
  });
  return null;
});

ipcMain.handle('pg:getSettingsForUi', () => getPgSettingsForUi());

ipcMain.handle(
  'pg:testConnection',
  async (
    _e,
    body: { host: string; port: number; user: string; database: string; password?: string }
  ): Promise<{ ok: true } | { ok: false; errorMessage: string }> => {
    const cfg = resolvePgFormToConfig(body);
    return testPgConnectionRaw(cfg);
  }
);

ipcMain.handle(
  'pg:saveAndReinit',
  async (
    _e,
    body: { host: string; port: number; user: string; database: string; password?: string }
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const toSave: PgConnectionConfig = {
        host: (body.host ?? '').trim(),
        port: Number(body.port),
        user: (body.user ?? '').trim(),
        database: (body.database ?? '').trim(),
        password: (body.password ?? '').trim(),
      };
      mergeSavePgToSettings(toSave);
      if (dbAdapter) {
        await dbAdapter.close().catch(() => {});
        dbAdapter = null;
      }
      await getAdapter();
      return { ok: true };
    } catch (e) {
      const msg = formatPgConnectionError(e);
      console.error('[pg:saveAndReinit] 재연결 실패');
      return { ok: false, error: msg };
    }
  }
);

// DataService IPC 핸들러
/** DB 초기화 후 최소 요구 버전과 비교 (DB 미연결 시 차단하지 않음) */
ipcMain.handle('app:getVersionGate', async () => {
  try {
    const adapter = await getAdapter();
    const raw = await adapter.getSetting(MIN_REQUIRED_VERSION_SETTING_KEY);
    const minTrim = (raw ?? '').trim();
    const blocked = Boolean(minTrim) && versionLessThan(TEAMLOG_RUNTIME_PACKAGE_VERSION, minTrim);
    return {
      appVersion: TEAMLOG_RUNTIME_PACKAGE_VERSION,
      minRequiredVersion: minTrim.length > 0 ? minTrim : null,
      blocked,
    };
  } catch (e) {
    console.error('[Teamlog] app:getVersionGate 실패:', e instanceof Error ? e.message : String(e));
    return {
      appVersion: TEAMLOG_RUNTIME_PACKAGE_VERSION,
      minRequiredVersion: null,
      blocked: false,
    };
  }
});

ipcMain.handle('db:initialize', async () => {
  const adapter = await getAdapter();
  await adapter.initialize();
});

ipcMain.handle('db:getConfig', async () => {
  const adapter = await getAdapter();
  return adapter.getConfig();
});

ipcMain.handle('db:getAllMembers', async () => {
  const adapter = await getAdapter();
  return adapter.getAllMembers();
});

ipcMain.handle('db:getTeams', async () => {
  const adapter = await getAdapter();
  return adapter.getTeams();
});

ipcMain.handle('db:insertTeam', async (_e, name: string) => {
  const adapter = await getAdapter();
  return adapter.insertTeam(name);
});

ipcMain.handle('db:verifyMasterLogin', async (_e, loginId: string, password: string) => {
  const adapter = await getAdapter();
  return adapter.verifyMasterLogin(loginId, password);
});

ipcMain.handle('db:verifyTeamAdmin', async (_e, teamId: string, loginId: string, password: string) => {
  const adapter = await getAdapter();
  return adapter.verifyTeamAdmin(teamId, loginId, password);
});

ipcMain.handle(
  'db:saveAdminTeamsTransaction',
  async (
    _e,
    payload: {
      teams: Array<{
        id: string;
        name: string;
        sortOrder: number;
        adminLoginId: string;
        passwordPlain?: string | null;
        extraAdmins?: Array<{ adminLoginId: string; passwordPlain?: string | null }>;
      }>;
      deletedTeamIds: string[];
      globalTeamAdmin?: {
        adminLoginId: string;
        passwordPlain?: string | null;
        extraAdmins?: Array<{ adminLoginId: string; passwordPlain?: string | null }>;
      } | null;
    }
  ) => {
    const adapter = await getAdapter();
    return adapter.saveAdminTeamsTransaction(payload);
  }
);

ipcMain.handle(
  'db:changeAdminPasswordSelf',
  async (
    _e,
    params: {
      scope: 'team' | 'global' | 'master';
      teamId?: string;
      adminLoginId?: string;
      currentPassword: string;
      newPassword: string;
    }
  ) => {
    const adapter = await getAdapter();
    return adapter.changeAdminPasswordSelf(params as ChangeAdminPasswordSelfParams);
  }
);

ipcMain.handle('db:getMembersByTeam', async (_e, teamId: string) => {
  const adapter = await getAdapter();
  return adapter.getMembersByTeam(teamId);
});

ipcMain.handle('db:getLogsByTeam', async (_e, teamId: string) => {
  const adapter = await getAdapter();
  return adapter.getLogsByTeam(teamId);
});

ipcMain.handle('db:getAuditLogs', async (_e, limit?: number) => {
  const adapter = await getAdapter();
  return adapter.getAuditLogs(limit);
});

ipcMain.handle('db:getMemberById', async (_e, id: string) => {
  const adapter = await getAdapter();
  return adapter.getMemberById(id);
});

ipcMain.handle('db:insertMember', async (_e, member: { name: string; role: string; avatar?: string; teamId: string }) => {
  const adapter = await getAdapter();
  return adapter.insertMember(member);
});

ipcMain.handle('db:updateMember', async (_e, id: string, updates: object) => {
  const adapter = await getAdapter();
  return adapter.updateMember(id, updates);
});

ipcMain.handle('db:deleteMember', async (_e, id: string) => {
  const adapter = await getAdapter();
  return adapter.deleteMember(id);
});

ipcMain.handle('db:getAllLogs', async () => {
  const adapter = await getAdapter();
  return adapter.getAllLogs();
});

ipcMain.handle('db:getLogsByMemberId', async (_e, memberId: string) => {
  const adapter = await getAdapter();
  return adapter.getLogsByMemberId(memberId);
});

ipcMain.handle('db:getLogsByDateRange', async (_e, startDate: string, endDate: string) => {
  const adapter = await getAdapter();
  return adapter.getLogsByDateRange(startDate, endDate);
});

ipcMain.handle(
  'db:insertLog',
  async (_e, log: object, requesterMemberId: string) => {
    const adapter = await getAdapter();
    return adapter.insertLog(log as Omit<WorkLog, 'id' | 'createdAt' | 'updatedAt'>, requesterMemberId);
  }
);

ipcMain.handle(
  'db:updateLog',
  async (_e, id: string, updates: object, requesterMemberId: string) => {
    const adapter = await getAdapter();
    return adapter.updateLog(id, updates as Partial<WorkLog>, requesterMemberId);
  }
);

ipcMain.handle('db:deleteLog', async (_e, id: string, requesterMemberId: string) => {
  const adapter = await getAdapter();
  return adapter.deleteLog(id, requesterMemberId);
});

ipcMain.handle('db:saveLogsBatch', async (_e, payload: SaveLogsBatchPayload) => {
  const adapter = await getAdapter();
  return adapter.saveLogsBatch(payload);
});

ipcMain.handle('db:deleteLogsByMemberId', async (_e, memberId: string) => {
  const adapter = await getAdapter();
  return adapter.deleteLogsByMemberId(memberId);
});

ipcMain.handle('db:getAllCategories', async () => {
  const adapter = await getAdapter();
  return adapter.getAllCategories();
});

ipcMain.handle('db:getCategoriesTree', async () => {
  const adapter = await getAdapter();
  return adapter.getCategoriesTree();
});

ipcMain.handle('db:saveCategories', async (_e, categories: string[]) => {
  const adapter = await getAdapter();
  return adapter.saveCategories(categories);
});

ipcMain.handle('db:saveCategoriesTree', async (_e, categories: object[]) => {
  const adapter = await getAdapter();
  return adapter.saveCategoriesTree(categories as Category[]);
});

ipcMain.handle('db:getSetting', async (_e, key: string) => {
  const adapter = await getAdapter();
  return adapter.getSetting(key);
});

ipcMain.handle('db:setSetting', async (_e, key: string, value: string) => {
  const adapter = await getAdapter();
  return adapter.setSetting(key, value);
});

ipcMain.handle('db:clearAllData', async () => {
  const adapter = await getAdapter();
  return adapter.clearAllData();
});

ipcMain.handle('db:exportData', async () => {
  const adapter = await getAdapter();
  return adapter.exportData();
});

ipcMain.handle('db:importData', async (_e, data: object) => {
  try {
    const adapter = await getAdapter();
    await adapter.importData(data as { teams?: WorkTeam[]; members: TeamMember[]; logs: WorkLog[]; categories: string[] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[DB] importData 실패:', msg);
    throw new Error(msg || '데이터 가져오기 실패');
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Teamlog app',
  });

  // 패키징/개발 모두 지원: app.getAppPath()가 app 루트 반환
  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  void mainWindow.loadURL(pathToFileURL(indexPath).href);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

let appIsQuitting = false;
app.on('before-quit', (e) => {
  if (appIsQuitting || !dbAdapter) return;
  e.preventDefault();
  appIsQuitting = true;
  const adapter = dbAdapter;
  dbAdapter = null;
  void adapter
    .close()
    .catch(() => {})
    .finally(() => {
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
