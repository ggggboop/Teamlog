# Teamlog 설계 문서 (design.md)

> 코드베이스 기준 **제품·아키텍처·UI/UX** 정리. `research.md`와 함께 참고.  
> 아래 **「AI·디자인 도구용」** 블록은 [Variant](https://variant.com/community) 등에 **그대로 붙여넣어** 화면·컴포넌트 리디자인 프롬프트의 맥락으로 쓰기 위한 것입니다.

---

## AI·디자인 도구용 (복붙 컨텍스트)

**제품 한 줄:** Electron/웹 데스크톱 앱. 팀 단위로 **주간 업무 로그**를 인라인 테이블에 입력하고, **관리자**는 통계·전체 기록·팀·카테고리를 관리한다.

**기술 스택 (UI):** React, Tailwind CSS, shadcn/ui(Radix), CSS 변수 테마, Lucide 아이콘.

**레이아웃 상수:** 메인은 **좌측 고정 사이드바(~288px)** + **우측 메인**. 작성/관리자 뷰는 동일 셸에서 전환.

**강조색 (브랜드):** RGB **(2, 161, 192)** — HEX `#02a1c0`. CSS `--primary`는 HSL `190 98% 38%` 근처. 그라데이션·글로우는 `primary` ↔ `primary-glow`.

**절대 지키면 안 되는 것:** 데이터 필드 의미·저장 로직·IPC·DB 스키마 변경은 이 문서 범위 밖(기능 유지).

---

## 화면 맵 (사용자 여정)

1. **팀 미선택** → `TeamSelectScreen`: 팀 목록 → 역할 선택(**작성자** / **관리자**).
2. **관리자 역할 + 팀 관리자 미인증** → 전체 화면 게이트: `AdminPasswordDialog` (팀 관리자 또는 마스터 분기) → 필요 시 `MasterLoginDialog` → `AdminSettingsDialog`(팀 CRUD는 마스터 전용 흐름).
3. **정상 진입** → `TeamSidebar` + 메인:
   - **작성:** `WeeklyRowView` (선택 팀원의 주간 로그).
   - **관리자:** `AdminDashboard` (통계 / 기록 / 관리 탭).

---

## A. 작성 페이지 (`WeeklyRowView` + `InlineLogRow`)

**목적:** 선택된 **한 팀원**의 **월~일 주간** 업무를 요일별 섹션으로 나누어 입력·저장.

**상단 헤더 (우측 정렬 액션):**
- **내 기록** → `PersonalRecordsDialog` (월/년·테이블 목록, 진행중 `taskCode` 그룹 표시).
- **내 통계** → `PersonalStatsDialog` (주/월 토글, 업무지표·분류별 요약; 관리자에서 열 때는 기간 오버라이드 가능).
- **저장** → 전 행 수집 후 검증 → `saveAllLogs` → 토스트 피드백.

**주간 본문:** `currentDate` 기준 **주 시작 월요일 ~ 일요일** 루프. 각 요일은 `section-card` 스타일 블록.

**요일 섹션 구조 (위→아래):**
1. **데이 헤더:** 좌측 요일 뱃지(오늘: primary 그라데이션+링, 주말: muted), 날짜 문구, 기록 건수 요약. 우측 **행 추가**.
2. **컬럼 헤더 그리드 (11열):**  
   `# | 시작일 | 대분류 | 소분류 | 업무내용 | 이슈사항 | 건수 | 총 소요시간 | 업무지표 | 현황 | (삭제)`
3. **데이터 행:** `InlineLogRow` — 기존 로그 행 + 빈 행(신규). 주말은 기본 빈 행 수 0, 평일은 기본 1 + 사용자 **행 추가**로 `extraRows` 증가.
4. **일자 하단 요약 바:** 연차(select) | 총 업무 시간(number, 기본 8h) | 주요(행 합계 h) | 기타(총−주요).

**인라인 행 (`InlineLogRow`) 필드 의미:**
- **시작일:** 진행중 업무 연속 시 시작일 표시.
- **대분류/소분류:** `categoriesTree` 있으면 2단 선택, 없으면 평탄 `categories` 문자열.
- **업무내용 / 이슈:** 자동 높이 조절 textarea.
- **건수·총 소요시간:** 숫자.
- **업무지표:** 고정 enum (`R&R/루틴업무` 등).
- **현황:** `완료` | `진행중` | `취소` — 진행중은 `taskCode`로 다일 연결.
- **진행중 불러오기:** 신규 행에서만 → `InProgressLogsDialog` → 선택 시 현재 행에 복제(원본 유지, `taskCode` 공유).

**검증 UX:** 저장 시 미입력 필드가 있으면 **행 키별 `invalidFields`** → 해당 입력에 **붉은 테두리** + destructive 토스트.

**오버레이 (작성 화면에서만):**
| 컴포넌트 | 트리거 | 내용 요약 |
|----------|--------|-----------|
| `PersonalRecordsDialog` | 헤더「내 기록」 | 기간 필터, 업무 목록 테이블 |
| `PersonalStatsDialog` | 헤더「내 통계」 | 주/월, 차트·표, 연차 요약(비동기) |
| `InProgressLogsDialog` | 신규 행「진행중 불러오기」 | 월별 진행중 로그 목록 → 현재 날짜 행으로 복제 |

---

## B. 좌측 사이드바 (`TeamSidebar`)

**너비:** `w-72`, `glass-sidebar`, 세로 전체.

**구역:**
1. **헤더:** 앱 타이틀「업무 기록」, 팀명 서브텍스트, 아이콘 뱃지(primary 그라데이션).
2. **탭:** **팀원선택** | **메모장** — 팀원 그리드(2열 카드, 선택 시 primary 그라데이션) / 선택 팀원 메모 textarea(blur 저장).
3. **미니 캘린더 (`MiniCalendar`):** 이전·다음 주, 오늘, 월/연 팝오버로 날짜 점프 → `currentDate` 변경.
4. **하단:** **팀 변경**(옵션) | **관리자**(작성자·미인증 관리자는 비활성+툴팁) | **환경 설정** → `SettingsDialog`.

---

## C. 관리자 대시보드 (`AdminDashboard`)

**전환:** 사이드바「관리자」— 메인이 `AdminDashboard`로 교체되고 팀원 선택은 해제 처리.

**상단 고정 헤더:** 제목「관리자 대시보드」+ **세그먼트 탭 3개** (동일 `statsPeriod`/`statsYear`/`statsMonth`를 통계·기록이 공유).

| 탭 | 내부 이름 | 역할 |
|----|-----------|------|
| 통계 | `statistics` | KPI 카드, 전월/전년 대비, 업무분류·대분류·소분류·팀원별 표, 파이 차트, **인쇄 보고서** 진입, 팀원 행 클릭 시 `PersonalStatsDialog`(기간 동기화) |
| 기록 | `records` | 전체 팀원 로그 필터링 테이블, 검색·컬럼 필터, 엑셀 내보내기, **팀원 선택** 소다이얼로그 |
| 관리 | `management` | 팀원 추가/편집, 카테고리 트리 편집, QA 카테고리 로드, 샘플/리셋 등 |

**전체 화면 오버레이:**
- **`PrintableReport`:** 통계 탭에서 인쇄 미리보기 시 메인을 **완전 대체**. A4 스타일 보고서, 상단만「닫기/인쇄」. primary 톤 강조.
- **`PersonalStatsDialog`:** 통계에서 팀원 클릭 시, `periodOverride`로 대시보드 기간과 일치.

**기록 탭 전용 다이얼로그:**
- **팀원 필터:** `Dialog` — 체크박스로 표시 대상 팀원 토글.

**통계 탭 (차트 상세):** 팀원별 세부 현황 등 **큰 `Dialog`** — 제목에 팀원명, 표/비교 내용(구현부 `AdminDashboard` 하단).

---

## D. 설정·인증 다이얼로그 (전역/게이트)

| 컴포넌트 | 열리는 조건 | UI 요약 |
|----------|-------------|---------|
| `TeamSelectScreen` | `selectedTeamId == null` | 전체 화면, glass 카드, 팀 리스트 → 역할 2버튼 |
| `AdminPasswordDialog` | 관리자 역할 + 팀 관리자 미인증 | ID/비밀번호, 마스터면 `MasterLoginDialog`로 이어짐 |
| `MasterLoginDialog` | 마스터 설정 진입 | ID/비밀번호 |
| `AdminSettingsDialog` | 마스터 로그인 성공 후 | 팀 목록 편집·삭제·저장 |
| `SettingsDialog` | 사이드바「환경 설정」 | DB 타입, 연결, 경로( Electron만 ), 새 DB/파일 선택 |

---

## E. 토스트·알림

- **Radix `Toaster` + `sonner`:** 저장 성공/실패, 관리자 저장 등 이중 구성 (`App.tsx`).

---

## F. 시각 디자인 시스템 (리디자인 시 유지할 규칙)

**토큰 소스:** `src/index.css` `:root` / `.dark`, `tailwind.config.ts` → `hsl(var(--*))`.

**강조색:** RGB **2, 161, 192** (`#02a1c0`). Primary HSL 약 **190° / 높은 채도 / L~38%(라이트)**.  
**보조:** `primary-glow`(밝은 청록), `accent`(연한 청록 배경), `ring`·`sidebar-primary` 동일 hue.

**패턴:** `glass-card`, `glass-sidebar`, `section-card`, `text-gradient`(primary→primary-glow), 오늘 날짜 `ring-primary/30` + `shadow-glow`.

**타이포:** 본문 15px, Inter + 시스템 폴백.

---

## G. 아키텍처 (요약)

```
Presentation: pages/Index → TeamSidebar | WeeklyRowView | AdminDashboard
State: useDataService → IDataService → InMemoryAdapter | IpcDatabaseAdapter
Electron: IPC + better-sqlite3 (메인 프로세스)
```

- UI는 **`IDataService`만** 의존.  
- DB는 **렌더러에서 직접 접근하지 않음** (Electron은 IPC).

---

## H. 도메인 모델 (UI와 연결되는 부분)

- **WorkLog:** `date`는 `YYYY-MM-DD`, `category`는 평탄 문자열 또는 `"대 > 소"`, **상태**·**업무지표**·**taskCode**(진행중 그룹).
- **설정 키:** `daily_total_{memberId}_{date}`, `member_memo_{memberId}`, `daily_leave_{memberId}_{date}` 등.

---

## I. 상호작용 패턴

| 패턴 | 구현 |
|------|------|
| 모달 | shadcn `Dialog`, `open` / `onOpenChange` |
| 저장 | `saveAllLogs` 일괄 → `refreshData` |
| 검증 | 행별 `validationErrors` / `invalidFields` |

---

## J. Electron UX

- **HashRouter** (`file://` 호환), Vite `base: './'`, preload IPC.

---

## K. 관련 문서

| 파일 | 내용 |
|------|------|
| `research.md` | 동작·파일별 상세 |
| `plan.md` | 향후 계획 (해당 시) |

---

## 컴포넌트 파일 빠른 색인 (리디자인 시)

| 경로 | 역할 |
|------|------|
| `src/pages/Index.tsx` | 팀 선택·게이트·메인 셸 |
| `src/components/TeamSidebar.tsx` | 좌측 바 |
| `src/components/WeeklyRowView.tsx` | 작성 주간 뷰 |
| `src/components/InlineLogRow.tsx` | 로그 한 줄 |
| `src/components/AdminDashboard.tsx` | 관리자 3탭 + 인쇄·다이얼로그 |
| `src/components/PrintableReport.tsx` | 인쇄/PDF 미리보기 전체 화면 |
| `src/components/SettingsDialog.tsx` | 환경 설정 |
| `src/components/TeamSelectScreen.tsx` | 초기 팀·역할 |
| `src/components/AdminPasswordDialog.tsx` | 팀 관리자 게이트 |
| `src/components/MasterLoginDialog.tsx` | 마스터 로그인 |
| `src/components/AdminSettingsDialog.tsx` | 팀 CRUD (마스터) |
| `src/components/PersonalStatsDialog.tsx` | 내 통계 |
| `src/components/PersonalRecordsDialog.tsx` | 내 기록 |
| `src/components/InProgressLogsDialog.tsx` | 진행중 복사 |
| `src/components/MiniCalendar.tsx` | 주간 날짜 네비 |
| `src/index.css` | CSS 변수 테마 |

---

*이 문서는 **온보딩·디자인 에이전트·Variant 등 외부 AI**에 맥락을 주기 위해 구조화했습니다. 구현 세부 코드 변경 시 함께 갱신하는 것을 권장합니다.*
