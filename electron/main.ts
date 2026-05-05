import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { ElectronDatabaseAdapter } from './database/ElectronDatabaseAdapter';
import type { Category, WorkLog, TeamMember, WorkTeam } from '../src/types/workLog';
import type { SaveLogsBatchPayload } from '../src/services/DatabaseAdapter';

let mainWindow: BrowserWindow | null = null;
let dbAdapter: ElectronDatabaseAdapter | null = null;

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

async function getAdapter(): Promise<ElectronDatabaseAdapter> {
  if (!dbAdapter) {
    dbAdapter = new ElectronDatabaseAdapter();
    await dbAdapter.initialize();
  }
  return dbAdapter;
}

// DB 경로 관련 IPC
ipcMain.handle('db:getDbPath', () => loadSavedDbPath());

ipcMain.handle('db:selectDbFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'DB 파일 선택 (공유 폴더 경로 가능)',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const selectedPath = result.filePaths[0];
    saveDbPath(selectedPath);
    if (dbAdapter) {
      await dbAdapter.setDbPath(selectedPath);
    }
    return selectedPath;
  }
  return null;
});

ipcMain.handle('db:createNewDb', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '새 DB 파일 생성',
    defaultPath: 'team-worklog.db',
    filters: [
      { name: 'SQLite Database', extensions: ['db'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!result.canceled && result.filePath) {
    const filePath = result.filePath.endsWith('.db') ? result.filePath : `${result.filePath}.db`;
    saveDbPath(filePath);
    if (dbAdapter) {
      await dbAdapter.setDbPath(filePath);
    }
    return filePath;
  }
  return null;
});

// DataService IPC 핸들러
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
    return adapter.changeAdminPasswordSelf(params);
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
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

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
