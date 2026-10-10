import { createPgPool } from "./pg-db";
import { runPgMigrations } from "./pg-migrate";
import { PG_MIGRATIONS } from "./pg-migrations";

export async function runStartupMigrations(
  databaseUrl: string,
): Promise<{ applied: number[] }> {
  const pool = createPgPool(databaseUrl, {
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    return await runPgMigrations(pool, PG_MIGRATIONS, {
      lockTimeoutMs: 60_000,
    });
  } finally {
    await pool.end();
  }
}

export async function startPlatformMigrations(
  env: NodeJS.ProcessEnv,
  deps?: {
    run?: typeof runStartupMigrations;
    exit?: (code: number) => void;
    log?: Pick<Console, "info" | "error">;
  },
): Promise<void> {
  const url = (env.DATABASE_URL ?? "").trim();
  if (!url) return;

  const run = deps?.run ?? runStartupMigrations;
  const exit: (code: number) => void =
    deps?.exit ?? ((code: number) => process.exit(code));
  const log = deps?.log ?? console;

  const lastVersion = PG_MIGRATIONS[PG_MIGRATIONS.length - 1].version;

  try {
    const { applied } = await run(url);
    if (applied.length === 0) {
      log.info("[platform-migrate] up to date");
    } else {
      log.info(`[platform-migrate] applied versions: [${applied.join(", ")}]`);
    }
  } catch (error: unknown) {
    const code =
      error != null && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    const codeText = typeof code === "string" ? code : "none";
    const redact = (text: string) => text.split(url).join("[DATABASE_URL]");
    const rawMessage = error instanceof Error ? error.message : String(error);
    let line = `[platform-migrate] start-up migration failed; this build knows versions 1..${lastVersion}; code=${codeText}; ${redact(rawMessage)}`;
    const inner =
      error instanceof AggregateError
        ? error.errors
        : error != null &&
            typeof error === "object" &&
            Array.isArray((error as { errors?: unknown }).errors)
          ? (error as { errors: unknown[] }).errors
          : [];
    if (inner.length > 0) {
      const parts = inner.slice(0, 4).map((e: unknown) => {
        const innerCode =
          e != null && typeof e === "object" && "code" in e
            ? (e as { code?: unknown }).code
            : undefined;
        const innerMessage = e instanceof Error ? e.message : String(e);
        return `code=${typeof innerCode === "string" ? innerCode : "none"}; ${redact(innerMessage)}`;
      });
      line = `${line} (${parts.join(" | ")})`;
    }
    log.error(line);
    exit(1);
  }
}
