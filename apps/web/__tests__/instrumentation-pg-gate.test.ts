import { describe, expect, it, vi } from "vitest";

const pg = vi.hoisted(() => ({
  loaded: false,
  startPlatformMigrations: vi.fn(),
}));

vi.mock("../lib/platform/pg-startup", () => {
  pg.loaded = true;
  return { startPlatformMigrations: pg.startPlatformMigrations };
});

async function freshRegister(): Promise<() => Promise<void>> {
  vi.resetModules();
  pg.loaded = false;
  pg.startPlatformMigrations.mockClear();
  const mod = await import("../instrumentation");
  return mod.register;
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
});
