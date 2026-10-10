import { createPgPool } from "./pg-db";
import { runPgMigrations } from "./pg-migrate";
import { PG_MIGRATIONS } from "./pg-migrations";

export async function runStartupMigrations(
  databaseUrl: string,
): Promise<{ applied: number[] }> {
  const pool = createPgPool(databaseUrl, { max: 1 });
  try {
    return await runPgMigrations(pool);
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
    const sqlstate = typeof code === "string" ? code : "none";
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = rawMessage.split(url).join("[DATABASE_URL]");
    log.error(
      `[platform-migrate] start-up migration failed; this build knows versions 1..${lastVersion}; sqlstate=${sqlstate}; ${message}`,
    );
    exit(1);
  }
}
