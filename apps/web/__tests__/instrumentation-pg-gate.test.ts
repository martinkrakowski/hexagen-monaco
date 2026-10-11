import { describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => ({
  loaded: false,
  startPlatformMigrations: vi.fn(),
}));

vi.mock("../lib/platform/pg-startup", () => {
  pg.loaded = true;
  return { startPlatformMigrations: pg.startPlatformMigrations };
});

const dbChoice = vi.hoisted(() => ({
  enforceProductionDatabaseChoice: vi.fn(),
}));

vi.mock("../lib/platform/production-db-choice", () => {
  return {
    enforceProductionDatabaseChoice: dbChoice.enforceProductionDatabaseChoice,
  };
});

async function freshRegister(): Promise<() => Promise<void>> {
  vi.resetModules();
  pg.loaded = false;
  pg.startPlatformMigrations.mockClear();
  dbChoice.enforceProductionDatabaseChoice.mockClear();
  const mod = await import("../instrumentation");
  return mod.register;
}

function withEnv(
  fn: () => Promise<void>,
  saved: Record<string, string | undefined>,
): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

describe("register() Postgres gate", () => {
  it("does not load the pg-startup module when DATABASE_URL is unset", async () => {
    const savedUrl = process.env.DATABASE_URL;
    const savedRuntime = process.env.NEXT_RUNTIME;
    try {
      delete process.env.DATABASE_URL;
      process.env.NEXT_RUNTIME = "nodejs";
      const register = await freshRegister();
      await register();
      expect(pg.loaded).toBe(false);
      expect(pg.startPlatformMigrations).not.toHaveBeenCalled();
    } finally {
      if (savedUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedUrl;
      if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = savedRuntime;
    }
  });

  it("loads pg-startup and runs the migrations when DATABASE_URL is set", async () => {
    const savedUrl = process.env.DATABASE_URL;
    const savedRuntime = process.env.NEXT_RUNTIME;
    try {
      process.env.DATABASE_URL = "postgres://u@127.0.0.1:1/x";
      process.env.NEXT_RUNTIME = "nodejs";
      const register = await freshRegister();
      await register();
      expect(pg.loaded).toBe(true);
      expect(pg.startPlatformMigrations).toHaveBeenCalledTimes(1);
    } finally {
      if (savedUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedUrl;
      if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = savedRuntime;
    }
  });

  it(
    "production with no DATABASE_URL and no PLATFORM_DB: the database choice is checked once and no migration starts",
    withEnv(
      async () => {
        delete process.env.DATABASE_URL;
        delete process.env.PLATFORM_DB;
        process.env.NEXT_RUNTIME = "nodejs";
        vi.stubEnv("NODE_ENV", "production");
        try {
          const calls: string[] = [];
          dbChoice.enforceProductionDatabaseChoice.mockImplementation(() => {
            calls.push("enforce");
          });
          pg.startPlatformMigrations.mockImplementation(() => {
            calls.push("migrations");
          });
          const register = await freshRegister();
          await register();
          expect(
            dbChoice.enforceProductionDatabaseChoice,
          ).toHaveBeenCalledTimes(1);
          expect(dbChoice.enforceProductionDatabaseChoice).toHaveBeenCalledWith(
            process.env,
          );
          expect(calls).toEqual(["enforce"]);
        } finally {
          vi.unstubAllEnvs();
        }
      },
      {
        NODE_ENV: process.env.NODE_ENV,
        PLATFORM_DB: process.env.PLATFORM_DB,
        DATABASE_URL: process.env.DATABASE_URL,
        NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      },
    ),
  );

  it(
    "enforce is not called when NEXT_RUNTIME is not nodejs",
    withEnv(
      async () => {
        delete process.env.DATABASE_URL;
        delete process.env.PLATFORM_DB;
        process.env.NEXT_RUNTIME = "edge";
        vi.stubEnv("NODE_ENV", "production");
        try {
          const register = await freshRegister();
          await register();
          expect(
            dbChoice.enforceProductionDatabaseChoice,
          ).not.toHaveBeenCalled();
        } finally {
          vi.unstubAllEnvs();
        }
      },
      {
        NODE_ENV: process.env.NODE_ENV,
        PLATFORM_DB: process.env.PLATFORM_DB,
        DATABASE_URL: process.env.DATABASE_URL,
        NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      },
    ),
  );

  it(
    "production with DATABASE_URL set: the database choice is checked before the migrations start",
    withEnv(
      async () => {
        process.env.DATABASE_URL = "postgres://u@127.0.0.1:1/x";
        delete process.env.PLATFORM_DB;
        process.env.NEXT_RUNTIME = "nodejs";
        vi.stubEnv("NODE_ENV", "production");
        try {
          const calls: string[] = [];
          dbChoice.enforceProductionDatabaseChoice.mockImplementation(() => {
            calls.push("enforce");
          });
          pg.startPlatformMigrations.mockImplementation(() => {
            calls.push("migrations");
          });
          const register = await freshRegister();
          await register();
          expect(calls).toEqual(["enforce", "migrations"]);
        } finally {
          vi.unstubAllEnvs();
        }
      },
      {
        NODE_ENV: process.env.NODE_ENV,
        PLATFORM_DB: process.env.PLATFORM_DB,
        DATABASE_URL: process.env.DATABASE_URL,
        NEXT_RUNTIME: process.env.NEXT_RUNTIME,
      },
    ),
  );
});
