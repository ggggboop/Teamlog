/**
 * 로컬 Docker PostgreSQL 기준 IDatabaseAdapter(ElectronDatabaseAdapter) 통합 검증.
 * 실행: PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=... PGDATABASE=teamlog npm run test:pg-integrity
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool, Client } from "pg";
import { ElectronDatabaseAdapter } from "../../electron/database/ElectronDatabaseAdapter";

let sqlLogCount = 0;

function installSqlLogger(): void {
  const wrap = (label: string, target: { query: (...args: unknown[]) => unknown }) => {
    const orig = target.query;
    target.query = function (this: unknown, ...args: unknown[]) {
      sqlLogCount += 1;
      const first = args[0];
      if (typeof first === "string") {
        const compact = first.replace(/\s+/g, " ").trim();
        const preview = compact.length > 400 ? `${compact.slice(0, 400)}…` : compact;
        const params = args[1];
        console.log(`[SQL #${sqlLogCount} ${label}]`, preview, params !== undefined ? "| params:" : "");
        if (params !== undefined) console.log("  →", JSON.stringify(params).slice(0, 500));
      } else if (first && typeof first === "object" && "text" in first) {
        const t = String((first as { text?: string }).text ?? "").replace(/\s+/g, " ").trim();
        const preview = t.length > 400 ? `${t.slice(0, 400)}…` : t;
        console.log(`[SQL #${sqlLogCount} ${label}]`, preview);
      }
      return orig.apply(this, args as Parameters<typeof orig>);
    };
  };
  wrap("pool", Pool.prototype as { query: (...args: unknown[]) => unknown });
  wrap("client", Client.prototype as { query: (...args: unknown[]) => unknown });
}

function setPgEnvFromHostOrDefaults(): void {
  process.env.PGHOST ||= "localhost";
  process.env.PGPORT ||= "5432";
  process.env.PGUSER ||= "postgres";
  process.env.PGPASSWORD ||= "1234";
  process.env.PGDATABASE ||= "teamlog";
}

describe("ElectronDatabaseAdapter × PostgreSQL (Docker)", () => {
  let adapter: ElectronDatabaseAdapter;
  let verifyPool: Pool;
  let testTeamId: string;
  let testMemberId: string;

  beforeAll(async () => {
    setPgEnvFromHostOrDefaults();
    installSqlLogger();
    adapter = new ElectronDatabaseAdapter();
    await adapter.initialize();

    verifyPool = new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      max: 2,
    });
  });

  afterAll(async () => {
    if (testMemberId) {
      await verifyPool.query("DELETE FROM work_logs WHERE member_id = $1", [testMemberId]).catch(() => {});
    }
    if (testMemberId) {
      await verifyPool.query("DELETE FROM members WHERE id = $1", [testMemberId]).catch(() => {});
    }
    if (testTeamId) {
      await verifyPool.query("DELETE FROM teams WHERE id = $1", [testTeamId]).catch(() => {});
    }
    await verifyPool?.end().catch(() => {});
    await adapter?.close().catch(() => {});
  });

  it("1) 연결·initialize: 스키마·부트스트랩·categories 시퀀스 일관성", async () => {
    expect(adapter.isConnected()).toBe(true);

    const tables = await verifyPool.query<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    const names = tables.rows.map((r) => r.t);
    for (const need of ["app_settings", "teams", "members", "work_logs", "categories"]) {
      expect(names).toContain(need);
    }

    const seq = await verifyPool.query<{ last: string; max: string }>(`
      SELECT last_value::text AS last, COALESCE((SELECT MAX(id)::text FROM categories), '0') AS max
      FROM categories_id_seq
    `);
    const lastVal = BigInt(seq.rows[0]!.last);
    const maxId = BigInt(seq.rows[0]!.max);
    expect(lastVal >= maxId).toBe(true);
    console.log(
      "[시퀀스 점검] categories_id_seq.last_value =",
      String(lastVal),
      "| MAX(categories.id) =",
      String(maxId)
    );
  });

  it("2) 팀·멤버 생성 후 insertLog → work_logs 행 존재", async () => {
    const team = await adapter.insertTeam(`[PG Integrity] ${Date.now()}`);
    testTeamId = team.id;
    expect(team.id.length).toBeGreaterThan(0);

    const member = await adapter.insertMember({
      name: "무결성 테스터",
      role: "QA",
      teamId: team.id,
      employeeNo: "999999",
    });
    testMemberId = member.id;

    const log = await adapter.insertLog(
      {
        memberId: member.id,
        date: "2026-05-09",
        category: "기획",
        content: "integration insertLog",
        duration: 1,
        count: 1,
        status: "완료",
        workIndicator: "기타/행정",
      },
      member.id
    );

    const row = await verifyPool.query<{ id: string; content: string }>(
      `SELECT id, content FROM work_logs WHERE id = $1`,
      [log.id]
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]!.content).toBe("integration insertLog");
  });

  it("3) 존재하지 않는 member_id로 insertLog 시 FK(23503)로 실패", async () => {
    const fakeMember = "00000000-0000-4000-8000-000000000001";
    await expect(
      adapter.insertLog(
        {
          memberId: fakeMember,
          date: "2026-05-09",
          category: "기획",
          content: "should fail",
          duration: 0.5,
          count: 1,
          status: "완료",
          workIndicator: "기타/행정",
        },
        fakeMember
      )
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("4) saveLogsBatch: 다건 INSERT 단일 트랜잭션(COMMIT 후 반영)", async () => {
    const before = await verifyPool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM work_logs WHERE member_id = $1`,
      [testMemberId]
    );
    const n0 = Number(before.rows[0]?.c ?? "0");

    await adapter.saveLogsBatch({
      requesterMemberId: testMemberId,
      deletedLogIds: [],
      updatedLogs: [],
      newLogs: [
        {
          memberId: testMemberId,
          date: "2026-05-10",
          category: "회의",
          content: "batch row A",
          duration: 2,
          count: 1,
          status: "완료",
          workIndicator: "R&R/루틴업무",
        },
        {
          memberId: testMemberId,
          date: "2026-05-11",
          category: "개발",
          content: "batch row B",
          duration: 3,
          count: 2,
          status: "진행중",
          workIndicator: "현안대응",
        },
      ],
    });

    const after = await verifyPool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM work_logs WHERE member_id = $1`,
      [testMemberId]
    );
    const n1 = Number(after.rows[0]?.c ?? "0");
    expect(n1).toBe(n0 + 2);

    const latest = await verifyPool.query<{ content: string }>(
      `SELECT content FROM work_logs WHERE member_id = $1 AND content LIKE 'batch row %' ORDER BY date`,
      [testMemberId]
    );
    expect(latest.rows.map((r) => r.content).sort()).toEqual(["batch row A", "batch row B"]);
  });
});
