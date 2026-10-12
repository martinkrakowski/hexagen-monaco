export type ProductionDbChoiceResult =
  | { ok: true }
  | { ok: true; warning: string }
  | { ok: false; message: string };

const REFUSE_NEITHER =
  "[platform-db] refusing to start: NODE_ENV=production needs a database choice. Set DATABASE_URL to use Postgres, or set PLATFORM_DB=sqlite to use the SQLite file on purpose. Neither is set.";

const REFUSE_BAD_PLATFORM_DB =
  `[platform-db] refusing to start: NODE_ENV=production needs a database choice. ` +
  `Set DATABASE_URL to use Postgres, or set PLATFORM_DB=sqlite to use the SQLite file on purpose. ` +
  `PLATFORM_DB is set to a value that is not "sqlite".`;

const WARNING =
  "[platform-db] PLATFORM_DB=sqlite is ignored because DATABASE_URL is set; Postgres is used. Remove one of the two.";

export function checkProductionDatabaseChoice(
  env: NodeJS.ProcessEnv,
): ProductionDbChoiceResult {
  if (env.NODE_ENV !== "production") return { ok: true };

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  const platformDb = (env.PLATFORM_DB ?? "").trim();

  if (databaseUrl) {
    if (platformDb === "sqlite") return { ok: true, warning: WARNING };
    return { ok: true };
  }

  if (platformDb === "sqlite") return { ok: true };

  return {
    ok: false,
    message: platformDb ? REFUSE_BAD_PLATFORM_DB : REFUSE_NEITHER,
  };
}

export function enforceProductionDatabaseChoice(
  env: NodeJS.ProcessEnv,
  deps?: {
    exit?: (code: number) => void;
    log?: Pick<Console, "error" | "warn">;
  },
): void {
  const result = checkProductionDatabaseChoice(env);
  const exit: (code: number) => void =
    deps?.exit ?? ((code: number) => process.exit(code));
  const log = deps?.log ?? console;

  if (!result.ok) {
    log.error(result.message);
    exit(1);
    return;
  }
  if ("warning" in result) log.warn(result.warning);
}
