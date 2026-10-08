import { Pool, types as pgTypes, TypeOverrides } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  PlatformDb,
  PlatformDbSession,
  RunResult,
  SqlParams,
  SqlValue,
} from "./db";

const CACHE_LIMIT = 256;
const MAX_ATTEMPTS = 5;
const NESTED_TX_ERROR =
  "Nested transactions are not supported: start one transaction and compose statements within it";
const PLAIN_IN_TX_ERROR =
  "plain db call inside a transaction: use the tx session passed to the callback";
const TX_FINISHED_ERROR = "transaction is finished";

function errorHasCode(error: unknown, code: string): boolean {
  if (error === null || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === code;
}

function isSerializationError(error: unknown): boolean {
  return errorHasCode(error, "40001") || errorHasCode(error, "40P01");
}

export function createPgPool(connectionString: string): Pool {
  const types = new TypeOverrides();
  const defaultTsParser = pgTypes.getTypeParser(1184) as (text: string) => Date;
  types.setTypeParser(1184, (text: string) =>
    defaultTsParser(text).toISOString(),
  );
  types.setTypeParser(1114, (text: string) =>
    defaultTsParser(text).toISOString(),
  );
  types.setTypeParser(16, (text: string) => (text === "t" ? 1 : 0));
  types.setTypeParser(3802, (text: string) => text);
  types.setTypeParser(114, (text: string) => text);
  types.setTypeParser(20, (text: string) => Number(text));
  types.setTypeParser(1700, (text: string) => Number(text));

  const pool = new Pool({
    connectionString,
    types,
    options: "-c TimeZone=UTC -c idle_in_transaction_session_timeout=30000",
    max: 10,
  });

  pool.on("error", (error: Error) => {
    console.error("Unexpected pg pool error:", error);
  });

  return pool;
}

function newCache() {
  return new Map<string, { text: string; paramNames: string[] | null }>();
}

function scanSql(
  sql: string,
  cache: Map<string, { text: string; paramNames: string[] | null }>,
): { text: string; paramNames: string[] | null } {
  const cached = cache.get(sql);
  if (cached) return cached;

  let result = "";
  let hasNamed = false;
  let hasPositional = false;
  const nameMap = new Map<string, number>();
  const paramNames: string[] = [];
  let paramCounter = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Single-quoted literal ('...'), with '' as an escaped quote
    if (ch === "'") {
      result += ch;
      i++;
      while (i < sql.length) {
        result += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            result += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      result += ch;
      i++;
      while (i < sql.length) {
        result += sql[i];
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Line comment (-- until newline)
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        result += sql[i];
        i++;
      }
      continue;
    }

    // Positional parameter
    if (ch === "?") {
      hasPositional = true;
      paramCounter++;
      result += `$${paramCounter}`;
      i++;
      continue;
    }

    // Named parameter (@name)
    if (ch === "@" && i + 1 < sql.length && /[A-Za-z_]/.test(sql[i + 1])) {
      hasNamed = true;
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) {
        j++;
      }
      const name = sql.slice(i + 1, j);
      if (!nameMap.has(name)) {
        paramCounter++;
        nameMap.set(name, paramCounter);
        paramNames.push(name);
      }
      result += `$${nameMap.get(name)!}`;
      i = j;
      continue;
    }

    result += ch;
    i++;
  }

  if (hasPositional && hasNamed) {
    throw new Error(
      "Cannot mix positional (?) and named (@name) parameters in a single statement",
    );
  }

  const entry = { text: result, paramNames: hasNamed ? paramNames : null };
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(sql, entry);
  return entry;
}

function bindParams(
  sql: string,
  params: SqlParams | undefined,
  cache: Map<string, { text: string; paramNames: string[] | null }>,
): { text: string; values: unknown[] } {
  const { text, paramNames } = scanSql(sql, cache);

  if (paramNames === null) {
    const arr = (params as readonly SqlValue[] | undefined) ?? [];
    return {
      text,
      values: arr.map((v) => (v === undefined ? null : v)),
    };
  }

  const record =
    (params as Readonly<Record<string, SqlValue>> | undefined) ?? {};
  const values: unknown[] = [];
  for (const name of paramNames) {
    if (!(name in record)) {
      throw new Error(`missing parameter @${name}`);
    }
    const v = record[name];
    values.push(v === undefined ? null : v);
  }
  return { text, values };
}

type TxToken = { active: boolean };
type SharedState = {
  cache: Map<string, { text: string; paramNames: string[] | null }>;
  nestedGuard: AsyncLocalStorage<TxToken>;
  closed: boolean;
};

export function createPgPlatformDb(pool: Pool): PlatformDb {
  const state: SharedState = {
    cache: newCache(),
    nestedGuard: new AsyncLocalStorage<TxToken>(),
    closed: false,
  };

  const run = async (sql: string, params?: SqlParams): Promise<RunResult> => {
    if (state.nestedGuard.getStore()?.active) {
      return Promise.reject(new Error(PLAIN_IN_TX_ERROR));
    }
    const { text, values } = bindParams(sql, params, state.cache);
    const result = await pool.query({ text, values });
    return { changes: result.rowCount ?? 0 };
  };

  const get = async <Row = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<Row | undefined> => {
    if (state.nestedGuard.getStore()?.active) {
      return Promise.reject(new Error(PLAIN_IN_TX_ERROR));
    }
    const { text, values } = bindParams(sql, params, state.cache);
    const result = await pool.query({ text, values });
    return result.rows[0] as Row | undefined;
  };

  const all = async <Row = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<Row[]> => {
    if (state.nestedGuard.getStore()?.active) {
      return Promise.reject(new Error(PLAIN_IN_TX_ERROR));
    }
    const { text, values } = bindParams(sql, params, state.cache);
    const result = await pool.query({ text, values });
    return result.rows as Row[];
  };

  return {
    dialect: "postgres" as const,
    run,
    get,
    all,
    isUniqueViolation: (error: unknown): boolean =>
      errorHasCode(error, "23505"),
    isForeignKeyViolation: (error: unknown): boolean =>
      errorHasCode(error, "23503"),
    transaction: async <T>(
      fn: (tx: PlatformDbSession) => Promise<T>,
    ): Promise<T> => {
      if (state.nestedGuard.getStore()?.active) {
        return Promise.reject(new Error(NESTED_TX_ERROR));
      }

      const nestedGuard = state.nestedGuard;
      const cache = state.cache;
      const client = await pool.connect();

      try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const token: TxToken = { active: true };
          let finished = false;
          const finishedErr = new Error(TX_FINISHED_ERROR);

          const tx: PlatformDbSession = {
            run: async (
              sql: string,
              params: SqlParams | undefined,
            ): Promise<RunResult> => {
              if (finished) throw finishedErr;
              const { text, values } = bindParams(sql, params, cache);
              const result = await client.query({ text, values });
              return { changes: result.rowCount ?? 0 };
            },
            get: async <Row = unknown>(
              sql: string,
              params?: SqlParams,
            ): Promise<Row | undefined> => {
              if (finished) throw finishedErr;
              const { text, values } = bindParams(sql, params, cache);
              const result = await client.query({ text, values });
              return result.rows[0] as Row | undefined;
            },
            all: async <Row = unknown>(
              sql: string,
              params?: SqlParams,
            ): Promise<Row[]> => {
              if (finished) throw finishedErr;
              const { text, values } = bindParams(sql, params, cache);
              const result = await client.query({ text, values });
              return result.rows as Row[];
            },
          };

          try {
            await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
            const result = await nestedGuard.run(token, () => fn(tx));
            await client.query("COMMIT");
            finished = true;
            token.active = false;
            return result;
          } catch (error) {
            // ROLLBACK, ignoring errors from the rollback itself.
            try {
              await client.query("ROLLBACK");
            } catch {
              // ignore rollback errors
            }
            finished = true;
            token.active = false;

            if (isSerializationError(error) && attempt < MAX_ATTEMPTS) {
              const wait = 20 * attempt + Math.floor(Math.random() * 21);
              await new Promise((resolve) => setTimeout(resolve, wait));
              continue;
            }

            if (isSerializationError(error)) {
              const err = error as Error & { name: string };
              err.name = "SerializationRetryExhausted";
              err.message += " (after 5 attempts)";
              throw err;
            }

            throw error;
          }
        }

        throw new Error("transaction loop exhausted without result");
      } finally {
        client.release();
      }
    },
    close: async () => {
      if (state.closed) return;
      state.closed = true;
      await pool.end();
    },
  };
}
