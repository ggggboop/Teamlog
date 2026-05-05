# Teamlog 프로젝트 상세 분석 보고서

> 이 문서는 Teamlog(업무 기록) 앱의 전체 구조, 동작 방식, 세부 구현을 종합 분석한 보고서입니다.

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [디렉터리 구조](#2-디렉터리-구조)
3. [기술 스택](#3-기술-스택)
4. [아키텍처](#4-아키텍처)
5. [데이터 모델](#5-데이터-모델)
6. [핵심 기능 상세](#6-핵심-기능-상세) — 세부: **6.2** 진행중 업무 불러오기, **6.4** 관리자 기록 탭, **6.6** 통계(개인·관리자)
7. [Electron 통합](#7-electron-통합)
8. [UI/컴포넌트 구조](#8-uicomponent-구조)
9. [빌드 파이프라인](#9-빌드-파이프라인)
10. [설정 및 저장소](#10-설정-및-저장소)
11. [보충: 관리자 기록·업무 ID](#11-보충-관리자-기록-탭-업무-id-기간-ui-실제-코드-기준-2026-04)

---

## 1. 프로젝트 개요

**Teamlog**는 팀 단위 업무 기록 관리 데스크톱 애플리케이션입니다.

- **주요 목적**: 팀원별 주간 업무(WorkLog) 기록, 관리, 통계 제공
- **실행 환경**: Electron 기반 Windows 데스크톱 앱 (웹 프리뷰 모드 지원)
- **데이터 저장**: SQLite(better-sqlite3) 또는 In-Memory(웹)
- **제품명**: `업무 기록` (package.json productName)

---

## 2. 디렉터리 구조

```
Teamlog/
├── electron/                    # Electron 메인 프로세스
│   ├── main.ts                  # 앱 진입점, BrowserWindow, IPC 핸들러
│   ├── preload.ts               # contextBridge → window.electron 노출
│   └── database/
│       └── ElectronDatabaseAdapter.ts  # better-sqlite3 직접 사용
├── src/
│   ├── main.tsx                 # React createRoot
│   ├── App.tsx                  # 라우터, QueryClient, Providers
│   ├── pages/
│   │   ├── Index.tsx            # 메인 페이지 (사이드바 + 뷰)
│   │   └── NotFound.tsx
│   ├── components/
│   │   ├── TeamSidebar.tsx      # 팀원 선택, 날짜, 메모, 캘린더
│   │   ├── WeeklyRowView.tsx    # 주간 업무 그리드, 일괄 저장
│   │   ├── InlineLogRow.tsx      # 업무 한 행 편집 컴포넌트
│   │   ├── InProgressLogsDialog.tsx   # 진행중 업무 불러오기
│   │   ├── PersonalStatsDialog.tsx   # 개인 통계
│   │   ├── PersonalRecordsDialog.tsx # 내 기록
│   │   ├── AdminDashboard.tsx    # 관리자 탭 (멤버/카테고리/데이터)
│   │   ├── AdminPasswordDialog.tsx
│   │   ├── SettingsDialog.tsx   # DB 경로 등 설정
│   │   ├── PrintableReport.tsx
│   │   ├── MiniCalendar.tsx
│   │   └── ui/                  # shadcn/ui 기반 40+ 컴포넌트
│   ├── hooks/
│   │   └── useDataService.ts    # 전역 데이터 훅 (members, logs, categories)
│   ├── services/
│   │   ├── DataService.ts       # IDataService 구현, 어댑터 선택
│   │   ├── DatabaseAdapter.ts   # IDatabaseAdapter 인터페이스
│   │   ├── IpcDatabaseAdapter.ts # Electron용 IPC 브리지
│   │   ├── InMemoryAdapter.ts   # 웹용 인메모리
│   │   └── schema.sql           # 참고용 스키마 (실제는 ElectronDB 내장)
│   ├── types/
│   │   └── workLog.ts           # TeamMember, WorkLog, Category 등
│   ├── data/
│   │   ├── sampleData.ts       # 샘플 데이터 생성
│   │   └── qaCategories.ts      # QA 업무분류 계층
│   ├── utils/
│   │   └── excelExport.ts       # xlsx 내보내기
│   └── lib/
│       └── utils.ts             # cn() 등 유틸
├── scripts/
│   └── build-electron.mjs       # esbuild로 main/preload → .cjs
├── dist/                        # Vite 빌드 산출물
├── dist-electron/               # Electron 번들 (main.cjs, preload.cjs)
├── release/                     # electron-builder 산출물 (win-unpacked 등)
├── package.json
├── vite.config.ts
├── index.html
└── tailwind.config.ts
```

---

## 3. 기술 스택

| 구분 | 기술 |
|------|------|
| **런타임** | Electron 40.x, Node 18 |
| **UI** | React 18, TypeScript 5.x |
| **빌드(렌더러)** | Vite 5, @vitejs/plugin-react-swc |
| **빌드(Electron)** | esbuild (CommonJS .cjs) |
| **패키징** | electron-builder (Windows NSIS) |
| **스타일** | Tailwind CSS 3, tailwindcss-animate, shadcn/Radix UI |
| **라우팅** | react-router-dom v6 (Electron: HashRouter) |
| **폼/검증** | react-hook-form, zod, @hookform/resolvers |
| **날짜** | date-fns (ko locale) |
| **DB(데스크톱)** | better-sqlite3 (네이티브, 메인 프로세스 전용) |
| **차트/보고** | recharts, xlsx |
| **UI 아이콘** | lucide-react |
| **토스트** | sonner |

---

## 4. 아키텍처

### 4.1 어댑터 패턴

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│ React (UI)      │────▶│ useDataService   │────▶│ DataService (Facade)    │
└─────────────────┘     └──────────────────┘     └────────────┬──────────┘
                                                               │
                                    ┌──────────────────────────┼──────────────────────────┐
                                    │                          │                          │
                                    ▼                          ▼                          │
                          ┌──────────────────┐     ┌──────────────────┐                   │
                          │ InMemoryAdapter   │     │ IpcDatabaseAdapter│                   │
                          │ (웹/미리보기)     │     │ (Electron 렌더러)  │                   │
                          └────────┬─────────┘     └────────┬─────────┘                   │
                                   │                         │ IPC (invoke)                │
                                   │                         ▼                             │
                                   │                ┌──────────────────┐                    │
                                   │                │ electron/main    │                    │
                                   │                │ ipcMain.handle   │                    │
                                   │                └────────┬─────────┘                    │
                                   │                         │                              │
                                   │                         ▼                             │
                                   │                ┌──────────────────┐                    │
                                   │                │ElectronDBAdapter │                    │
                                   │                │(better-sqlite3)  │                    │
                                   │                └──────────────────┘                    │
                                   │                                                         │
                                   └─────────────────────────────────────────────────────────┘
```

- **DataService**: 환경에 따라 `window.electron` 존재 여부로 어댑터 선택
- **웹**: `InMemoryAdapter` (배열/Map, 새로고침 시 초기화)
- **Electron**: `IpcDatabaseAdapter` → `ipcRenderer.invoke` → 메인 `ElectronDatabaseAdapter`

### 4.2 데이터 흐름 (저장 예시)

1. `WeeklyRowView`에서 저장 버튼 클릭 → `handleSave`
2. `rowRefs.current.forEach`로 각 행 `getData()` 수집
3. `newLogs`, `updatedLogs`, `pendingDeletes` 분류
4. `onSaveAll(newLogs, updatedLogs, pendingDeletes)` 호출
5. `useDataService.saveAllLogs` → 삭제 → 수정 → 추가 순으로 `dataService` 호출
6. `refreshData()`로 전체 데이터 재로드

---

## 5. 데이터 모델

### 5.1 TypeScript 타입 (`src/types/workLog.ts`)

```typescript
interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  teamId: string;
}

interface WorkLog {
  id: string;
  memberId: string;
  date: string;           // YYYY-MM-DD
  category: string;       // "대분류" 또는 "대분류 > 소분류"
  content: string;
  issues?: string;
  duration: number;
  count: number;
  status: WorkStatus;     // '완료' | '진행중' | '취소'
  workIndicator: WorkIndicatorType;
  taskCode?: string;      // 동일 업무 추적용 코드(11.1 참고)
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: number;
  name: string;
  parentId: number | null;  // null = 대분류
  sortOrder: number;
}
```

### 5.2 SQLite 스키마 (ElectronDatabaseAdapter 내장)

- **app_settings**: key-value (일일 총 업무시간, 메모, 연차 등)
- **members**: id, name, role, avatar, team_id (→ teams)
- **teams**: id, name, sort_order
- **work_logs**: id, member_id, date, category, content, issues, duration, count, status, work_indicator, task_code
- **categories**: id, name, parent_id, sort_order (대분류/소분류 트리)

레거시 `urgency`/`difficulty`는 `runMigrations()`로 `work_indicator` 등으로 이전됨.

### 5.3 설정 키 패턴

- `daily_total_{memberId}_{date}`: 일일 총 업무시간
- `member_memo_{memberId}`: 팀원별 메모
- `daily_leave_{memberId}_{date}`: 연차/반차 등

---

## 6. 핵심 기능 상세

### 6.1 주간 업무 뷰 (WeeklyRowView)

- **구조**: `currentDate` 기준 주(월~일) 각 날짜별 섹션
- **행 구성**: `dayLogs`(저장된 로그) + `emptyRowsNeeded`(빈 행)
- **저장 로직**:
  - `rowRefs` Map으로 각 행 ref 보관
  - `getData()`: isNew(신규), id(기존/불러온), isEmpty
  - `hasChanges`: 날짜 변경 포함 모든 필드 비교
  - `pendingDeletes`: 삭제 버튼 클릭 시 ID 누적

### 6.2 진행중 업무 불러오기 (InProgressLogsDialog) — 심화

#### 목적

이전에 **다른 날짜에 기록해 둔 `진행중` 업무**를, 현재 주간 화면의 **빈 행(또는 포커스한 행)**으로 불러와 이어서 편집·저장하기 위한 기능이다. DB에 이미 존재하는 `WorkLog` 행을 “복사”하는 것이 아니라, **같은 `id`를 가진 기존 레코드를 행 편집기에 올려 둔 뒤** 사용자가 날짜·시간 등을 수정하고 저장하면 **업데이트**로 반영된다.

#### 데이터 모델과 `taskCode`

- `WorkLog.status`는 `'완료' | '진행중' | '취소'` 중 하나다 (`schema.sql` CHECK).
- **`taskCode`**: “여러 일자에 걸친 동일 업무”를 묶기 위한 **내부 그룹 ID**(UUID 등). `진행중`으로 저장할 때 새로 발급되거나, 불러오기 시 **원본 로그의 `taskCode`를 그대로** 가져온다.
- **관리자/내 기록 화면**에서는 `taskCode`로 묶어 한 줄로 요약하는 패턴이 있다 (`AdminDashboard`, `PersonalRecordsDialog`: `status === '진행중' && taskCode` 그룹화).

#### InProgressLogsDialog 동작

| 항목 | 내용 |
|------|------|
| **입력 `logs`** | `WeeklyRowView`에서 **현재 팀원**(`memberId`)만 필터한 목록. 여기에 **`loadedLogIds`에 포함된 id는 제외**한다. |
| **필터** | `status === '진행중'` 이고, 선택한 **연·월**의 `date`가 해당 월 `[startOfMonth, endOfMonth]` 안에 있는 로그만 표시. |
| **정렬** | `date` 내림차순(최근 날짜 우선). |
| **연/월 UI** | 현재 주의 연·월을 `defaultYear` / `defaultMonth`로 초기값에 반영. |
| **불러오기 클릭** | `onLoadLog(log)` → 다이얼로그 닫힘. |

#### WeeklyRowView ↔ 행 ref 연결

1. 각 `InlineLogRow`는 `rowRefs` Map에 `dateKey-row-...` 키로 등록된다.
2. 행의 **“진행중 업무 불러오기”** 버튼은 `onOpenInProgress={() => handleOpenInProgress(해당 행 ref)}`로 연결된다.
3. `handleOpenInProgress`는 `activeRowRef`에 그 ref를 저장하고 다이얼로그를 연다.
4. `handleLoadLog(log)`에서 **`activeRowRef.setData({...})`**만 수행한다. 주입 필드: `id`, `category`, `content`, `issues`, `count`, `duration`, **`status: '진행중'`**, `workIndicator`, **`startDate: log.date`**(원본 기록일), **`taskCode`**.
5. 동시에 `loadedLogIds`에 `log.id`를 추가해, **같은 로그를 다시 목록에서 고르지 못하게** 한다(중복 불러오기 방지).
6. 다이얼로그가 닫히면 `activeRowRef`는 `null`로 초기화된다.

#### InlineLogRow 내부: `loadedLogId`와 저장 분기

- `setData`에 `id`가 오면 **`loadedLogId` state**에 저장한다.
- `getData()` 시 **`effectiveId = loadedLogId ?? log?.id`**. 즉 불러온 직후에는 **원본 DB id**가 유지된다.
- **`isNew` 판정**: `isNew && !log && !loadedLogId` → 불러오기 후에는 **기존 로그 수정** 경로로 간다(`isNew`가 아님).
- `useEffect`로 `log` prop과 동기화할 때, **`loadedLogId`가 있고 `log?.id`와 다르면** 외부 prop으로 덮어쓰지 않아 **편집 중 덮어쓰기**를 막는다.
- 저장 시 `WeeklyRowView`는 `data.id`가 있으면 `updatedLogs`에 넣고, 날짜를 바꾸면 `updates.date = dateKey`로 **다른 날짜로 이동**도 가능하다.
- **`진행중` 유지 시 `taskCode`**: 변경 시 `data.taskCode || crypto.randomUUID()`로 보강.

#### 저장 후 정리

- 일괄 저장 성공 시 `setLoadedLogIds([])`로 초기화되어, 다시 불러오기 목록에 동일 로그가 나타날 수 있다(이미 DB에 반영된 상태).

#### 디버그

- `InProgressLogsDialog`는 개발 시 콘솔에 월별 건수·날짜 범위 등을 로그한다(`[InProgressLogsDialog]`).

### 6.3 일괄 저장 (saveAllLogs)

- **순서**: 삭제 → 수정 → 추가
- **필터**: 삭제 예정 ID는 수정 목록에서 제외
- **저장 후**: `refreshData()` 호출로 UI 동기화

### 6.4 관리자 모드 (AdminDashboard)

- 비밀번호 검증 후 진입
- 팀원 CRUD, 카테고리 트리 편집, 데이터 가져오기/초기화/샘플 생성

### 6.5 DB 경로 선택

- `settings.json` (userData)에 `dbPath` 저장
- IPC: `db:selectDbFile`, `db:createNewDb`로 파일 선택/생성
- 공유 폴더/네트워크 경로 지원, WAL 실패 시 DELETE 모드 자동 전환

### 6.6 통계: 개인 및 관리자 대시보드

같은 `WorkLog` 배열을 두고 **집계 범위(기간)·집계 단위(팀 전체 vs 한 사람)**만 다르게 가져가며, **업무 지표·대분류/소분류** 정의는 공통이다.

#### 공통 개념

| 용어 | 의미 |
|------|------|
| **업무 건수(`totalTasks`)** | 기간 내 로그 **행 수**(한 행 = 한 건). |
| **총 업무시간** | `duration` 합. |
| **업무 지표(`workIndicator`)** | R&R/루틴업무, 현안대응, 품질고도화 과제, 조직운영관리, 기타/행정 — 로그별 1개. |
| **대분류/소분류** | `category` 문자열이 `"대분류"` 단독이거나 `"대분류 > 소분류"` 형태. `categories` 플랫 리스트에서 `split(' > ')`로 뼈대를 잡는다. |
| **이전 기간(관리자만)** | 월 단위면 **직전 달**, 연 단위면 **직전 해** 로그로 총 시간·건수를 비교한다. |

#### 관리자 대시보드 (`AdminDashboard` — 통계 탭)

- **기간**: `statsPeriod` — `'month'`(선택 연·월 한 달) 또는 `'year'`(선택 연도 전체).
- **데이터 소스**: `logs` 전체 중 `date`가 `[periodStart, periodEnd]` 문자열 범위에 드는 것만. **팀/멤버 필터 없음**(전 팀 로그).
- **집계 산출물** (`useMemo` `stats`):
  - `totalHours`, `totalTasks`, `totalCount`(수량 필드 `count` 합), **지표별 건수** `workIndicatorCounts`
  - **이전 기간** `prevTotalHours`, `prevTotalTasks`
  - **`categoryDetailStats`**: 플랫 `categories` 각 문자열당 소요시간·건수·지표별 건수
  - **`majorCategoryStats`**: 대분류별 `participantCount`(실시 **멤버** 수), 시간, 건수, 전체 대비 비중
  - **`subCategoryStatsByMajor`**: 대분류 키별 소분류 배열(시간·건수·실시자 수, 대분류 내 비중)
  - **`memberStats`**: 멤버별 시간·건수·지표별 건수 → 카드 클릭 시 **`PersonalStatsDialog`** 오픈
- **UI**: 상단 요약 카드, 업무 지표 한 줄, **대분류 테이블(클릭) + 소분류 테이블**, 팀원별 카드, 기록 탭·관리 탭 등.

#### 개인 통계 (`PersonalStatsDialog`)

- **데이터 소스**: `logs` 중 **`memberId === 선택 팀원`**만.
- **기간 (두 가지 진입 경로)**:
  1. **주간 화면 “내 통계”** (`WeeklyRowView`): `periodOverride` **없음** → 사용자가 **주간 / 월간** 토글. `currentDate` 기준 `startOfWeek`~`endOfWeek`(월요일 시작) 또는 `startOfMonth`~`endOfMonth`.
  2. **관리자에서 팀원 카드 클릭**: `periodOverride: { start: periodStart, end: periodEnd }` — 관리자 통계와 **동일한 월/연** 구간. 이때 주간·월간 토글은 숨김.
- **지표**: 총 시간, 총 건수, **평균 업무 밀도**(`총 시간 / 총 건수`), **실제 근무일**(로그가 있는 **서로 다른 날짜** 수), **하루 평균**(근무일 기준 시간·건수).
- **업무 지표 분류**: 지표별 **건수·기간 내 소요시간·전체 시간 대비 %**.
- **업무분류**: 관리자와 동일하게 **대분류 목록(클릭) → 우측에 해당 대분류의 소분류** 시간·건수·대분류 내 비중. 소분류가 없는 대분류만 있으면 우측에 안내 문구.
- **연차/반차**: `getDailyLeaveType`이 있으면 기간 내 일자를 순회하며 유형별 일수 집계(비동기 `useEffect`).

#### 개인 vs 관리자 요약

| 구분 | 기본 기간 | 로그 범위 | 실시자(참가자) 수 |
|------|-----------|-----------|-------------------|
| 관리자 | 선택 월 또는 연 | 전체 멤버 | 대분류/소분류 테이블에 표시 |
| 개인 | 주/월 또는 관리자와 동일 | 한 멤버 | 표시 없음(본인만) |

이 구조 덕분에 **관리자에서 팀원 카드로 연 개인 통계**는 팀 대시보드와 **같은 달·같은 정의**로 숫자를 맞출 수 있다(멤버 필터만 다름).

---

## 7. Electron 통합

### 7.1 메인 프로세스 (`electron/main.ts`)

- `BrowserWindow`: preload.cjs, contextIsolation, nodeIntegration: false
- 로드 경로: `app.getAppPath()/dist/index.html` (file://)
- IPC 채널: `db:*` (getAllMembers, insertLog, updateLog 등 30+ 핸들러)
- DB 경로: `settings.json` 또는 기본 `userData/team-worklog.db`

### 7.2 프리로드 (`electron/preload.ts`)

- `contextBridge.exposeInMainWorld('electron', {...})`
- `ipcRenderer.invoke` 래핑으로 `window.electron.getAllMembers()` 등 노출

### 7.3 네이티브 모듈

- `better-sqlite3`는 esbuild `external`로 번들 제외
- 런타임에 메인 프로세스에서만 로드
- 패키징 시 app.asar.unpacked에 포함

---

## 8. UI/컴포넌트 구조

### 8.1 페이지 계층

```
App
├── QueryClientProvider
│   ├── TooltipProvider
│   ├── Toaster, Sonner
│   └── HashRouter (Electron) / BrowserRouter (웹)
│       └── Routes
│           ├── / → Index
│           └── * → NotFound
```

### 8.2 Index 레이아웃

```
Index
├── AdminPasswordDialog
├── TeamSidebar (좌측)
│   ├── 팀원 선택 / 메모 탭
│   ├── MiniCalendar
│   └── Settings 버튼 → SettingsDialog
└── main
    ├── AdminDashboard (관리자)
    └── WeeklyRowView (팀원 선택 시)
        ├── InProgressLogsDialog
        ├── PersonalStatsDialog
        ├── PersonalRecordsDialog
        └── 일자별 섹션
            └── InlineLogRow (기존/빈 행)
```

### 8.3 InlineLogRow 동작

- **ref**: `getData()`, `setData()`, `hasContent()` 노출
- **불러오기**: `setData()`로 `loadedLogId` 설정 → `getData()` 시 `effectiveId = loadedLogId ?? log?.id`
- **삭제 버튼**: loadedLogId 우선 → `onDelete(effectiveId)`
- **검증**: `invalidFields`로 미작성 필드 표시

---

## 9. 빌드 파이프라인

```
npm run build:electron
  → Vite (mode: electron)
  → dist/index.html, dist/assets/*

npm run build:main
  → esbuild
  → dist-electron/electron/main.cjs, preload.cjs
  → external: electron, better-sqlite3

npm run electron:build
  → 위 두 단계 + electron-builder --win
  → release/win-unpacked/업무 기록.exe
```

- **package.json main**: `dist-electron/electron/main.cjs`
- **Electron 모드**: `vite.config` base: `'./'` (file:// 경로 대응)

---

## 10. 설정 및 저장소

### 10.1 설정 파일

- **settings.json**: `app.getPath('userData')/settings.json`
  - `dbPath`: SQLite DB 파일 경로 (공유 폴더 가능)

### 10.2 DB 초기화

1. `SCHEMA_SQL` 실행
2. `runMigrations()` (레거시 컬럼 → work_indicator 등)
3. `initializeCategories()` (QA 카테고리 시드)
4. members 비어 있으면 `seedSampleData()` (sampleData + qaCategories)

### 10.3 샘플 데이터

- `generateSampleData()`: 팀원 4명, QA 카테고리, 2~3월 평일 로그
- 이슈 10건 중 1건, status '진행중' 비율 포함
- `DataService.initialize()` 및 Electron 어댑터 모두 사용

---

## 부록: 주요 파일 요약

| 파일 | 역할 |
|------|------|
| `DataService.ts` | IDataService 구현, InMemoryAdapter / IpcDatabaseAdapter 선택 |
| `useDataService.ts` | members, logs, categories 상태 + CRUD/refreshData |
| `WeeklyRowView.tsx` | 주간 그리드, rowRefs, handleSave, `InProgressLogsDialog`·`PersonalStatsDialog` |
| `InlineLogRow.tsx` | 행 편집, ref(getData/setData), `loadedLogId`·불러오기 연동 |
| `InProgressLogsDialog.tsx` | 진행중 로그 월별 목록·불러오기 |
| `PersonalStatsDialog.tsx` | 개인 통계(주/월 또는 관리자 기간 동기) |
| `AdminDashboard.tsx` | 통계·기록·관리 탭, `RecordsTab`·`StatisticsTab`, 팀원 카드→개인 통계 |

| `excelExport.ts` | `exportRecordsTableToExcel` (관리자 기록 탭과 동일: 업무 ID 열 등) |
| `ElectronDatabaseAdapter.ts` | SQLite 스키마, 마이그레이션, 시드 |
| `electron/main.ts` | IPC 핸들러 등록, DB 어댑터 래핑 |

---

## 11. 보충: 관리자 기록 탭, 업무 ID, 기간 UI (실제 코드 기준, 2026-04)

### 11.1 `WorkLog.id` vs `taskCode`

- **`id`**: DB 행(로그 한 건)당 고유한 식별자. 같은 업무를 여러 날짜/행에 나눠 기록하면 행마다 `id`가 다른다.
- **`taskCode`**: (선택) 여러 일자에 걸친 “하나의 업무 흐름”을 이어 주는 값. `WeeklyRowView`에서 진행중 상태로 저장 시 `crypto.randomUUID()`를 쓰거나, 진행중 불러오기/복제 시 원본 `taskCode`를 유지한다.
- **`완료`로 변경 시**: 업데이트 분기에서 `taskCode: data.taskCode`로 지우지 않고 유지한다. 그래서 진행중→완료로 이어진 한 업무는 동일 `taskCode`를 가질 수 있다.
- **처음부터 `완료`만 저장**: `taskCode`가 비어 있음이 정상(업무 단위 식별자 없음).

관리자 **기록** 탭 테이블과 **엑셀 추출**의 「업무 ID」 열은 **`taskCode`**를 표시하며, 없으면 `—`이다. **`id`와 혼동시키면 안 된다.**

### 11.2 `RecordsTab` (`AdminDashboard.tsx`)

- 기간 컨트롤: **연도 select → (월간 모드일 때만) 월 select → 월간 / 연간** 토글. 상위 `statsPeriod` / `statsYear` / `statsMonth`와 상태를 공유한다.
- `status === '진행중' && taskCode`인 로그는 `taskCode`별로 한 줄로 그룹화하여 시간을 합산한다.
- 검색어에 `taskCode`도 포함한다. `exportRecordsTableToExcel`에 `업무 ID`열이 있다.

### 11.3 `StatisticsTab` 툴바 순서

**텍스트 | 도넛** 다음 **연도·(월간 시) 월** 선택, 그 다음 **월간 | 연간**, 오른쪽에 **보고서**.

---

*이 보고서는 프로젝트 구조를 이해하고 유지보수·기능 확장 시 참고용으로 작성되었습니다.*
