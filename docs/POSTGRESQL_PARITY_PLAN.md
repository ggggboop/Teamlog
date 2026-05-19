# PostgreSQL 기능 동등성·빌드 계획

SQLite(또는 레거시 동작) 대비 Electron 메인 프로세스의 PostgreSQL 어댑터(`electron/database/ElectronDatabaseAdapter.ts`)와 동일한 기능·신뢰성을 확보하기 위한 계획서입니다.

---

## 1. 현재 아키텍처 요약

| 구간 | 역할 |
|------|------|
| 렌더러 | `IpcDatabaseAdapter` → preload IPC → 메인 프로세스 |
| 메인 | `ElectronDatabaseAdapter` — `pg` Pool, DDL 적용 및 CRUD |
| 스키마 | `SCHEMA_SQL`로 PG 테이블 생성(`teams`, `members`, `work_logs`, `categories`, `app_settings` 등) |
| 데이터 이전 | 코드 주석 기준 — **앱 내 export/import**로 SQLite → PG 이행 |

**연결 확인(`SELECT 1`)과 저장 성공은 별개**입니다. DML 실패 시 UI에서는 “저장 안 됨”으로만 보일 수 있으므로, 권한·제약·FK·트랜잭션을 분리해서 점검합니다.

---

## 2. 빌드·실행 파이프라인

| 단계 | 명령/목적 |
|------|------------|
| 렌더러(Electron 모드) | `npm run build:electron` — `vite build --mode electron` |
| 메인·프리로드 | `npm run build:main` — `scripts/build-electron.mjs` (esbuild → `dist-electron/electron/*.cjs`) |
| 로컬 실행 | `npm run electron:dev` 또는 동일 순서 후 `electron .` |
| 설치 패키지 | `npm run electron:build` / `electron:dist` → `electron-builder` |

### 2.1 `pg` 번들링

- `scripts/build-electron.mjs`에서 **`pg`는 esbuild에 번들**됩니다. `package.json`의 `build.files`가 `dist`/`dist-electron`만 포함하는 경우, `external: ['pg']`로 두면 패키지 앱에서 `require('pg')`가 깨지므로 번들 방식을 사용합니다.
- `dependencies`의 `pg`는 타입·개발 시 해석용으로 유지합니다.
- 향후 `pg-native` 등 **네이티브 addon**을 쓰면 Electron용 **rebuild**·`asarUnpack`을 별도 검토합니다.

---

## 3. 기능 동등성(패리티) 작업 단계

### 3.A 인터페이스별 추적표

`src/services/DatabaseAdapter.ts`의 `IDatabaseAdapter` **전 메서드**에 대해 아래 형식으로 체크리스트를 유지합니다.

- **기대 동작**(SQLite/InMemory 레퍼런스 또는 제품 요구사항)
- **PG 구현 위치**(파일·메서드명)
- **차이 허용 여부** 및 메모

범위:

- Teams: 조회·삽입·마스터/팀 관리자 검증·관리자 일괄 저장 트랜잭션·본인 비밀번호 변경
- Members: 전체·팀별·ID 조회·추가·수정·삭제
- Logs: 전체·팀별·멤버별·기간별·삽입/수정/삭제(작성자 검증)·`saveLogsBatch`·멤버별 일괄 삭제
- Categories: flat(`getAllCategories`/`saveCategories`)·tree(`getCategoriesTree`/`saveCategoriesTree`)
- Settings: `getSetting`/`setSetting`
- 데이터 관리: `clearAllData`·`exportData`·`importData`

### 3.B 스키마·데이터 형식

- **CHECK 제약**: `work_logs.status`, `work_indicator` 등 — 레거시·수동 데이터·구 import와 충돌 시 마이그레이션 또는 UI 정규화.
- **날짜/시각**: PG `DATE`/`TIMESTAMPTZ` vs 과거 SQLite TEXT — 앱 레벨 ISO 문자열 유지 및 **타임존·자정 경계** 시나리오 테스트.
- **카테고리**: 계층+`SERIAL`, `TRUNCATE RESTART IDENTITY` 등 — 정렬·부모-자식 순서가 제품 요구와 일치하는지 시나리오로 고정.

### 3.C 트랜잭션·재시도

다음 등에서 트랜잭션 경계 확인:

- `saveLogsBatch` / `saveAdminTeamsTransaction` / `importData` / `saveCategoriesTree`

`runWriteRetriesAsync`는 **일시적 연결·데드락** 등에 한해 재시도하고, 제약 위반류는 재시도해도 해결되지 않음 — 로그·에러 전달이 사용자/운영에 충분한지 검토.

### 3.D 마이그레이션·스키마 버전

- 단기: `CREATE IF NOT EXISTS` + `ensureReferentialFKs` 등 보강 패턴 유지.
- 중기: **`schema_migrations`(또는 동등)** 테이블로 버전 관리, `ALTER` 누락 방지.
- SQLite → PG: 구 앱 **export** → 신 앱 **import** 후 행 수·샘플 화면·관리자 로그인까지 검증.

### 3.E 검증·테스트

- **로컬**: Docker PostgreSQL + 동일 연결 정보로 개발 빌드.
- **자동화**: 메인 또는 스크립트로 최소 플로우 — `연결 → insertMember → insertLog → SELECT`.
- **수동**: 메인 프로세스 콘솔 `[DB]` 및 PostgreSQL 에러 코드(`23503` FK, `23514` CHECK 등) 수집.

---

## 4. “저장이 안 된다” 분류 절차

1. **동일 DB 사용자로 psql에서 `INSERT` 가능 여부** — 스키마/테이블 `USAGE`, DML 권한.
2. **앱 저장 시 메인 프로세스 에러 로그** — 제약/FK/권한.
3. **`requesterMemberId`와 `log.memberId` 일치** (`insertLog`에서 불일치 시 거부).
4. **`members`에 존재하는 `member_id`인지** — FK 위반 여부.
5. **`PGDATABASE`·`search_path`** — 다른 DB/스키마 조회 가능성.

---

## 5. NAS·저사양 서버 운영: 연결 한도와 TCP Keepalive (QA 권장)

Teamlog Electron 클라이언트는 `pg` 풀에 **`keepAlive: true`** 만 두었습니다. 이는 끊긴 연결을 빨리 감지하는 데 도움이 되며, **앱 코드에서 1~2분처럼 짧은 keepalive 주기를 강제하지는 않습니다**(실제 타이밍은 OS·런타임 TCP 설정에 가깝습니다).

반면 PostgreSQL 서버의 **`tcp_keepalives_idle` 등을 너무 짧게(예: 60~120초)** 잡으면, 클라이언트 수 × 유휴 연결만큼 **주기적 “살아 있니?” 트래픽·CPU 오버헤드**가 늘 수 있습니다. NAS(Ryzen R1600, RAM 8GB 등)처럼 여유가 작은 환경에서는 제미나이가 지적한 부하 우려가 **합리적**입니다.

### 구분 정리

| 구간 | 역할 | 비고 |
|------|------|------|
| 클라이언트 `keepAlive: true` | 소켓 TCP keepalive 사용 | 짧은 주기 강제 없음; `keepAliveInitialDelayMillis` 미설정 |
| 서버 `tcp_keepalives_*` | 유령 연결 정리 속도 조절 | 너무 짧으면 부하, 너무 길면 좀비 점유 지속 |

### QA 권장 `postgresql.conf` (황금 밸런스 예시)

근본적으로는 **`max_connections`** 를 동시 사용자·클라이언트 풀(앱당 최대 3 + `LISTEN` 등)을 감안해 넉넉히 잡는 것이 우선입니다. 그다음 유령 연결 정리는 **너무 공격적이지 않은** keepalive로 맞춥니다.

아래는 **시작점**으로 쓸 수 있는 값입니다. 실제 트래픽·VPN·NAS 부하를 보고 `tcp_keepalives_idle` 만 300~900초 사이에서 조정하세요.

```text
# 동시 접속 상한 (환경에 맞게 상향)
max_connections = 200

# 유휴 연결에 첫 keepalive까지 초 (너무 짧지 않게: 600 권장, 부하 허용 시 300)
tcp_keepalives_idle = 600

# 이후 프로브 간격(초)·실패 허용 횟수
tcp_keepalives_interval = 30
tcp_keepalives_count = 3
```

- **1~2분(`idle` 60~120)** 은 사용자 수가 많을 때 NAS CPU·LAN 패킷 측면에서 부담이 클 수 있어, 위처럼 **5~10분대**에서 시작하는 편이 QA 관점에서 안전합니다.
- 변경 후 **PostgreSQL 재시작** 또는 설정 리로드 정책에 맞게 적용합니다.

---

## 6. 산출물·우선순위 제안

1. **추적표**: 스프레드시트 또는 이 문서에 섹션 추가로 `IDatabaseAdapter` 100% 매핑.
2. **통합 테스트**: Docker PG 기반 최소 시나리오(선택).
3. **운영 체크리스트**: DB 사용자 권한·백업·연결 풀 파라미터.

---

## 7. 관련 파일

| 파일 | 설명 |
|------|------|
| `electron/database/ElectronDatabaseAdapter.ts` | PG 어댑터·DDL·쓰기 재시도 |
| `electron/database/pgSettingsStorage.ts` | `settings.json`·환경변수 병합, 연결 테스트 |
| `electron/database/pgAuthUtils.ts` | 비밀번호 해시 등 |
| `electron/main.ts` | IPC 핸들러·`getAdapter()` |
| `src/services/IpcDatabaseAdapter.ts` | 렌더러 측 IPC 래핑 |
| `src/services/DatabaseAdapter.ts` | `IDatabaseAdapter` 계약 |
| `scripts/build-electron.mjs` | esbuild(`pg` 번들, `electron`만 external) |

---

*문서 목적: 구현 순서 공유 및 이슈 트래킹 기준점. 세부 수정 시 이 파일과 변경 로그를 함께 갱신하는 것을 권장합니다.*
