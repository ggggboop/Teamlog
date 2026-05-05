# Electron 전환 가이드

이 문서는 웹 앱을 Electron + SQLite 기반 로컬 앱으로 전환하는 방법을 설명합니다.

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│              (React Components, Hooks)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     DataService                              │
│              (src/services/DataService.ts)                   │
│         단일 데이터 접근 계층 - 추상화된 인터페이스            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   DatabaseAdapter                            │
│              (IDatabaseAdapter 인터페이스)                    │
├─────────────────────────────┬───────────────────────────────┤
│    IndexedDBAdapter (웹)    │  ElectronDatabaseAdapter      │
│         현재 사용 중         │    (Electron에서 사용)         │
└─────────────────────────────┴───────────────────────────────┘
                                               │
                                               ▼
                              ┌───────────────────────────────┐
                              │         better-sqlite3        │
                              │    (SQLite 파일 저장)          │
                              └───────────────────────────────┘
```

## 전환 단계

### 1. Electron 프로젝트 설정

```bash
# Electron 및 필요 패키지 설치
npm install electron electron-builder --save-dev
npm install better-sqlite3

# TypeScript 타입 설치
npm install @types/better-sqlite3 --save-dev
```

### 2. Electron Main Process 설정

`electron/main.ts` 파일 생성:

```typescript
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { ElectronDatabaseAdapter } from '../src/services/ElectronDatabaseAdapter';

let mainWindow: BrowserWindow | null = null;
const dbAdapter = new ElectronDatabaseAdapter();

async function createWindow() {
  await dbAdapter.initialize();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('dist/index.html');
}

// IPC 핸들러 등록
ipcMain.handle('db:getDbPath', () => dbAdapter.getConfig().dbPath);

ipcMain.handle('db:selectDbFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    await dbAdapter.setDbPath(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('db:createNewDb', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    defaultPath: 'team-worklog.db',
  });
  if (!result.canceled && result.filePath) {
    await dbAdapter.setDbPath(result.filePath);
    return result.filePath;
  }
  return null;
});

app.whenReady().then(createWindow);
```

### 3. Preload Script 설정

`electron/preload.ts` 파일 생성:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getDbPath: () => ipcRenderer.invoke('db:getDbPath'),
  selectDbFile: () => ipcRenderer.invoke('db:selectDbFile'),
  createNewDb: () => ipcRenderer.invoke('db:createNewDb'),
});
```

### 4. ElectronDatabaseAdapter 활성화

`src/services/ElectronDatabaseAdapter.template.ts`의 주석을 해제하고 
`ElectronDatabaseAdapter.ts`로 이름 변경

### 5. DataService에서 어댑터 교체

`src/services/DataService.ts` 수정:

```typescript
// 웹 환경
// import { IndexedDBAdapter } from './IndexedDBAdapter';
// const adapter = new IndexedDBAdapter();

// Electron 환경
import { ElectronDatabaseAdapter } from './ElectronDatabaseAdapter';
const adapter = new ElectronDatabaseAdapter();
```

### 6. package.json 설정

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "electron .",
    "electron:build": "electron-builder"
  },
  "build": {
    "appId": "com.yourcompany.team-worklog",
    "productName": "팀 업무 기록",
    "files": ["dist/**/*", "electron/**/*"],
    "win": {
      "target": "nsis"
    },
    "mac": {
      "target": "dmg"
    }
  }
}
```

## 데이터베이스 스키마

SQLite 스키마는 `src/services/schema.sql`에 정의되어 있습니다.

### 테이블 구조

| 테이블 | 설명 |
|--------|------|
| `members` | 팀원 정보 |
| `work_logs` | 업무 기록 |
| `categories` | 업무 카테고리 |
| `app_settings` | 앱 설정 |

### 인덱스

- `idx_work_logs_member_id` - 멤버별 조회 최적화
- `idx_work_logs_date` - 날짜별 조회 최적화
- `idx_work_logs_category` - 카테고리별 조회 최적화

## DB 파일 경로 관리

### 기본 경로
- Windows: `%APPDATA%\team-worklog\team-worklog.db`
- macOS: `~/Library/Application Support/team-worklog/team-worklog.db`
- Linux: `~/.config/team-worklog/team-worklog.db`

### 사용자 지정 경로
사용자가 환경 설정에서 DB 파일 경로를 변경하면:
1. 새 경로가 `settings.json`에 저장됨
2. 앱 재시작 시 해당 경로의 DB 파일 사용
3. DB 파일이 없으면 자동 생성

## 주의사항

1. **데이터 마이그레이션**: IndexedDB 데이터를 SQLite로 마이그레이션하려면 
   웹 앱에서 데이터 내보내기 후 Electron 앱에서 가져오기 수행

2. **네이티브 모듈**: better-sqlite3는 네이티브 모듈이므로 
   electron-rebuild 필요

3. **보안**: contextIsolation과 preload script를 사용하여 
   메인 프로세스와 렌더러 프로세스 분리

4. **백업**: 중요 데이터는 정기적으로 내보내기 기능으로 백업 권장
