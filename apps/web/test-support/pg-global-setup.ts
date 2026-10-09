// A `kill -9` of the vitest process leaves this embedded server running and
// its temp directory behind; nothing reaps them. Set PLATFORM_TEST_PG_URL to
// an external server to avoid this.
import { Pool } from "pg";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type EmbeddedPostgres from "embedded-postgres";
import { runPgMigrations } from "../lib/platform/pg-migrate";
import type { ProvidedContext } from "vitest";

/** Context injected by Vitest into the global-setup function. The first
 * argument vitest passes is the internal Project instance, whose `provide`
 * method forwards into the `ProvidedContext` that `inject` reads in tests. */
interface VitestGlobalSetupContext {
  provide: <T extends keyof ProvidedContext & string>(
    key: T,
    value: ProvidedContext[T],
  ) => void;
}

function utcStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 12);
}

function randomHex(n: number): string {
  return Array.from({ length: n }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : null;
      // Give the port back before Postgres is told to bind it.
      server.close(() => {
        if (port === null) reject(new Error("Could not determine a free port"));
        else resolve(port);
      });
    });
  });
}

// Extract the 12-digit UTC stamp from a database name and return its epoch
// milliseconds. Returns 0 when the name doesn't match the pattern.
function dbStampMs(name: string): number {
  const match = name.match(/^hx_(tpl_)?(\d{12})[0-9a-f]{4}/);
  if (!match) return 0;
  const ts = match[2];
  const year = parseInt(ts.slice(0, 4), 10);
  const month = parseInt(ts.slice(4, 6), 10) - 1;
  const day = parseInt(ts.slice(6, 8), 10);
  const hour = parseInt(ts.slice(8, 10), 10);
  const minute = parseInt(ts.slice(10, 12), 10);
  return Date.UTC(year, month, day, hour, minute);
}

export default async function setup(
  context: VitestGlobalSetupContext,
): Promise<() => Promise<void>> {
  const startTime = Date.now();

  // Run id: UTC yyyymmddhhmm + 4 random hex digits
  const run = `${utcStamp()}${randomHex(4)}`;
  const templateName = `hx_tpl_${run}`;

  let homeUrl: string;
  let embedded: EmbeddedPostgres | null = null;
  let embeddedDir: string | null = null;

  if (process.env.PLATFORM_TEST_PG_URL) {
    homeUrl = process.env.PLATFORM_TEST_PG_URL;
  } else {
    let port = 0;
    let pgUser = "";
    let pgPassword = "";

    try {
      const uid = process.getuid ? process.getuid() : -1;
      if (uid === 0) throw new Error("running as root");

      port = await getFreePort();
      embeddedDir = await mkdtemp(join(tmpdir(), "embedded-pg-"));
      pgUser = "postgres";
      pgPassword = "password";

      const { default: Ctor } = await import("embedded-postgres");
      embedded = new Ctor({
        databaseDir: embeddedDir,
        port,
        user: pgUser,
        password: pgPassword,
        initdbFlags: ["--locale=C", "--encoding=UTF8"],
        postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
        createPostgresUser: false,
      });

      await embedded.initialise();
      await embedded.start();
    } catch (error) {
      console.warn(
        `[pg-global-setup] embedded-postgres could not start: ${
          (error as Error).message ?? String(error)
        }; set PLATFORM_TEST_PG_URL.`,
      );
      context.provide("pgHomeUrl", "");
      context.provide("pgTemplate", "");
      context.provide("pgRun", run);
      return () => Promise.resolve();
    }

    try {
      await embedded!.createDatabase("hx_home");
      homeUrl = `postgres://${pgUser}:${pgPassword}@127.0.0.1:${port}/hx_home`;
    } catch (error) {
      await embedded!.stop();
      if (embeddedDir) {
        await rm(embeddedDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  // From here on a failure must not leave the embedded server running: vitest
  // gets a teardown only when this function returns.
  const stopEmbedded = async () => {
    if (!embedded) return;
    await embedded.stop().catch(() => undefined);
    if (embeddedDir) {
      await rm(embeddedDir, { recursive: true, force: true });
    }
  };
  try {
    await prepareTemplate(homeUrl, templateName);
  } catch (error) {
    await stopEmbedded();
    throw error;
  }

  context.provide("pgHomeUrl", homeUrl);
  context.provide("pgTemplate", templateName);
  context.provide("pgRun", run);

  const elapsed = Date.now() - startTime;
  const wasEmbedded = embedded !== null;
  console.log(
    `[pg-global-setup] start-up took ${elapsed}ms (${wasEmbedded ? "embedded" : "server"})`,
  );

  return async () => {
    // Teardown: drop the template and stop the embedded server.
    const tearDownPool = new Pool({ connectionString: homeUrl });
    try {
      await tearDownPool.query(
        `DROP DATABASE IF EXISTS ${templateName} WITH (FORCE)`,
      );
    } finally {
      await tearDownPool.end();
      await stopEmbedded();
    }
  };
}

async function prepareTemplate(
  homeUrl: string,
  templateName: string,
): Promise<void> {
  // A connect timeout turns "nothing is listening for us" into a failure the
  // run reports, not a hang.
  const homePool = new Pool({
    connectionString: homeUrl,
    connectionTimeoutMillis: 15000,
  });
  try {
    // Drop leftover databases from previous runs: owned by the current role,
    // matching the run-name pattern, and older than 24 hours.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const leftovers = await homePool.query<{ datname: string }>(
      `SELECT datname FROM pg_database
       WHERE datname ~ '^hx_(tpl_)?(\\d{12})[0-9a-f]{4}'
         AND datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    );
    for (const row of leftovers.rows) {
      const stampMs = dbStampMs(row.datname);
      if (stampMs > 0 && stampMs < cutoff) {
        await homePool.query(
          `DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`,
        );
      }
    }

    // Create the template database from template0 (a clean slate).
    await homePool.query(
      `CREATE DATABASE ${templateName} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'`,
    );
  } finally {
    await homePool.end();
  }

  // Migrate the template, then end the pool so it can be cloned.
  const templateUrl = homeUrl.replace(/\/[^/]+$/, `/${templateName}`);
  const templatePool = new Pool({ connectionString: templateUrl });
  try {
    await runPgMigrations(templatePool);
  } finally {
    await templatePool.end();
  }
}
