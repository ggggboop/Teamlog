# 변경 이력 (CHANGELOG)

형식은 날짜별로 묶으며, 같은 날 수정한 내용을 **사용자 관점**과 **기술 관점**으로 구분합니다.

---

## 2026-05-09

### 사용자 관점

- PostgreSQL 연동 Electron 앱(Windows 설치/압축 해제본)에서, 패키지 안에 DB 클라이언트가 빠져 연결이 실패할 수 있던 경우를 줄였습니다.

### 기술 관점

- `scripts/build-electron.mjs`: esbuild에서 `pg`를 **external에서 제외**하고 메인 번들에 포함. `package.json`의 `build.files`가 `dist`·`dist-electron` 위주일 때 런타임 `require('pg')` 실패를 방지합니다.
- `docs/POSTGRESQL_PARITY_PLAN.md`의 `pg` 번들링 설명을 현재 방식에 맞게 갱신했습니다.

---

## 2026-05-06

### 사용자 관점

- 팀원이 주간 업무를 저장할 때, 같은 팀에 다른 사람이 남긴 진행 중 업무가 있다 해도 본인 기록 저장이 차단되지 않도록 했습니다. 이전에는 저장 시 「본인 소유 업무만 수정할 수 있습니다」 오류가 뜰 수 있었습니다.

### 기술 관점

- `saveAllLogs`( `src/hooks/useDataService.ts` )의 「연관 진행중 업무 자동 완료」 루프가 팀 전체 `logs`를 순회하면서 타인 소유 진행중 로그까지 `mergedById`에 넣은 뒤, 바로 다음 소유 검증(`requesterMemberId`)에서 클라이언트 예외가 발생하던 문제를 수정했습니다.
- 자동 완료 대상 행 추가 전에 `orig.memberId === requesterMemberId`일 때만 처리하도록 한정했습니다.

---

### 네트워크 공유 환경 안정성 강화 패치

#### 사용자 관점

- 공유 폴더나 네트워크 드라이브에서 DB에 쓸 때 잠깐 충돌이 나도, 앱이 더 오래 기다리고 자동으로 여러 번 다시 시도하도록 바꿔 저장·초기화 실패가 줄어들 수 있습니다. (완전히 손상된 DB 등은 여전히 복구가 필요할 수 있습니다.)

#### 기술 관점

- `electron/database/ElectronDatabaseAdapter.ts`: `PRAGMA busy_timeout = 60000`(60초) 적용.
- SQLite 쓰기 경로 공통 `runWriteRetries` / `runWriteRetriesAsync` — 최대 6회 시도(첫 시도 + 재시도 5회), `SQLITE_PROTOCOL`/locking protocol류는 재시도 전 500ms 지연.
- DB 파일 열기 실패에도 동일 정책의 연결 재시도 루프 적용.
- 초기 스키마·마이그레이션 실행, 일괄 업무 저장, 멤버/설정/카테고리/임포트 등 변이(mutating) API에 재시도 래핑.
