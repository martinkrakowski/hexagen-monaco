// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  checkProductionDatabaseChoice,
  enforceProductionDatabaseChoice,
} from "../production-db-choice";

const REFUSE_NEITHER =
  "[platform-db] refusing to start: NODE_ENV=production needs a database choice. Set DATABASE_URL to use Postgres, or set PLATFORM_DB=sqlite to use the SQLite file on purpose. Neither is set.";
const REFUSE_BAD_PLATFORM_DB =
  "[platform-db] refusing to start: NODE_ENV=production needs a database choice. Set DATABASE_URL to use Postgres, or set PLATFORM_DB=sqlite to use the SQLite file on purpose. PLATFORM_DB is set to a value that is not \"sqlite\".";
const WARNING =
  "[platform-db] PLATFORM_DB=sqlite is ignored because DATABASE_URL is set; Postgres is used. Remove one of the two.";

describe("checkProductionDatabaseChoice", () => {
  it.each`
    nodeEnv             | databaseUrl                              | platformDb              | expected
    ${"development"}    | ${undefined}                             | ${undefined}            | ${{ ok: true }}
    ${undefined}        | ${undefined}                             | ${undefined}            | ${{ ok: true }}
    ${"test"}           | ${"postgres://u:h@h/db"}                 | ${undefined}            | ${{ ok: true }}
    ${"production"}     | ${"postgres://u:h@h/db"}                 | ${undefined}            | ${{ ok: true }}
    ${"production"}     | ${"postgres://u:h@h/db"}                 | ${"postgres"}           | ${{ ok: true }}
    ${"production"}     | ${"postgres://u:h@h/db"}                 | ${"  sqlite  "}         | ${{ ok: true, warning: WARNING }}
    ${"production"}     | ${undefined}                             | ${"sqlite"}             | ${{ ok: true }}
    ${"production"}     | ${undefined}                             | ${" sqlite "}           | ${{ ok: true }}
    ${"production"}     | ${""}                                    | ${"sqlite"}             | ${{ ok: true }}
    ${"production"}     | ${"   "}                                 | ${"sqlite"}             | ${{ ok: true }}
    ${"production"}     | ${undefined}                             | ${undefined}            | ${{ ok: false, message: REFUSE_NEITHER }}
    ${"production"}     | ${""}                                    | ${undefined}            | ${{ ok: false, message: REFUSE_NEITHER }}
    ${"production"}     | ${undefined}                             | ${"SQLite"}             | ${{ ok: false, message: REFUSE_BAD_PLATFORM_DB }}
    ${"production"}     | ${undefined}                             | ${"sqlit"}              | ${{ ok: false, message: REFUSE_BAD_PLATFORM_DB }}
    ${"production"}     | ${undefined}                             | ${"postgres"}           | ${{ ok: false, message: REFUSE_BAD_PLATFORM_DB }}
    ${"production"}     | ${undefined}                             | ${"1"}                  | ${{ ok: false, message: REFUSE_BAD_PLATFORM_DB }}
    ${"production"}     | ${undefined}                             | ${""}                   | ${{ ok: false, message: REFUSE_NEITHER }}
  `(
    "NODE_ENV=$nodeEnv DATABASE_URL=$databaseUrl PLATFORM_DB=$platformDb",
    ({ nodeEnv, databaseUrl, platformDb, expected }) => {
      const env: NodeJS.ProcessEnv = { NODE_ENV: nodeEnv };
      if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
      if (platformDb !== undefined) env.PLATFORM_DB = platformDb;
      expect(checkProductionDatabaseChoice(env)).toEqual(expected);
    },
  );

  it("the refusal message does not contain the PLATFORM_DB value", () => {
    const result = checkProductionDatabaseChoice({
      NODE_ENV: "production",
      PLATFORM_DB: "s3cr3t-looking-value",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("s3cr3t-looking-value");
    }
  });

  it("the warning does not contain any part of DATABASE_URL", () => {
    const result = checkProductionDatabaseChoice({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pw@host/db",
      PLATFORM_DB: "sqlite",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).not.toContain("pw");
      expect(result.warning).not.toContain("host");
      expect(result.warning).not.toContain("postgres://");
    }
  });
});

describe("enforceProductionDatabaseChoice", () => {
  it("on refuse it logs the error once and exits 1", () => {
    const exit = vi.fn();
    const log = { error: vi.fn(), warn: vi.fn() };
    enforceProductionDatabaseChoice(
      { NODE_ENV: "production" },
      { exit, log },
    );
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(REFUSE_NEITHER);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("on ok it logs nothing and does not exit", () => {
    const exit = vi.fn();
    const log = { error: vi.fn(), warn: vi.fn() };
    enforceProductionDatabaseChoice(
      { NODE_ENV: "test" },
      { exit, log },
    );
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("on the warning row it logs warn once and does not exit", () => {
    const exit = vi.fn();
    const log = { error: vi.fn(), warn: vi.fn() };
    enforceProductionDatabaseChoice(
      { NODE_ENV: "production", DATABASE_URL: "postgres://u:h@h/db", PLATFORM_DB: "sqlite" },
      { exit, log },
    );
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(WARNING);
    expect(exit).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});
