// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Pool } from "pg";
import { GET } from "../route";
import {
  getPlatformStore,
  closePlatformStore,
} from "../../../../../lib/platform";
import { createTestPgDb } from "../../../../../test-support/pg-test-db";
import { runStartupMigrations } from "../../../../../lib/platform/pg-startup";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { sub: "user-1" } })),
}));

describe("GET /api/billing/entitlement served from Postgres", () => {
  let pool: Pool;
  let url: string;
  let drop: () => Promise<void>;
  let savedDbUrl: string | undefined;
  let savedDbPath: string | undefined;

  beforeAll(async () => {
    const result = await createTestPgDb({ empty: true });
    pool = result.pool;
    url = result.url;
    drop = result.drop;
    savedDbUrl = process.env.DATABASE_URL;
    savedDbPath = process.env.PLATFORM_DB_PATH;
    await runStartupMigrations(url);
    process.env.DATABASE_URL = url;
    delete process.env.PLATFORM_DB_PATH;
    await getPlatformStore().billing.upsert({
      userId: "user-1",
      plan: "repo",
      repoLimit: 3,
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: 1_759_900_000_000,
    });
  });

  afterAll(async () => {
    await closePlatformStore();
    if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDbUrl;
    if (savedDbPath === undefined) delete process.env.PLATFORM_DB_PATH;
    else process.env.PLATFORM_DB_PATH = savedDbPath;
    await drop();
  });

  it("answers 200 from Postgres: repo plan, numeric period end, not free", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usesFreeQuota: boolean;
      entitlement: { plan: string; currentPeriodEnd: unknown };
    };
    expect(body.usesFreeQuota).toBe(false);
    expect(body.entitlement.plan).toBe("repo");
    expect(typeof body.entitlement.currentPeriodEnd).toBe("number");

    const raw = await pool.query<{ plan: string }>(
      "SELECT plan FROM entitlements WHERE user_id = $1",
      ["user-1"],
    );
    expect(raw.rows[0].plan).toBe("repo");
  });
});
