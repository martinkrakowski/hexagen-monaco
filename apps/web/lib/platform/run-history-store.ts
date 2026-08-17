import type Database from "better-sqlite3";

export interface StageTelemetryInput {
  stage: number;
  label: string;
  durationMs: number;
  usedLLM: boolean;
  retryCount: number;
  inputTokensEstimate: number;
  outputTokensActual: number;
  servedFromCache: boolean;
  summary: string;
  modelName?: string;
  refinerModelName?: string;
}

export interface PersistRunEventInput {
  runId?: string;
  projectId?: string;
  telemetry: StageTelemetryInput;
  now?: number;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  projectId: string | null;
  stage: number;
  label: string;
  model: string | null;
  refinerModel: string | null;
  durationMs: number;
  retryCount: number;
  inputTokens: number;
  outputTokens: number;
  servedFromCache: boolean;
  usedLlm: boolean;
  summary: string;
  costCents: number | null;
  createdAt: number;
}

export interface DailyRunCount {
  day: string;
  runs: number;
  costCents: number;
}

interface RunEventRow {
  id: string;
  run_id: string;
  project_id: string | null;
  stage: number;
  label: string;
  model: string | null;
  refiner_model: string | null;
  duration_ms: number;
  retry_count: number;
  input_tokens: number;
  output_tokens: number;
  served_from_cache: number;
  used_llm: number;
  summary: string;
  cost_cents: number | null;
  created_at: number;
}

interface PriceRow {
  usd_per_1k_input: number;
  usd_per_1k_output: number;
}

export function computeCostCents(
  inputTokens: number,
  outputTokens: number,
  price: { usdPer1kInput: number; usdPer1kOutput: number } | null,
): number | null {
  if (!price) return null;
  const usd =
    (inputTokens / 1000) * price.usdPer1kInput +
    (outputTokens / 1000) * price.usdPer1kOutput;
  return Math.round(usd * 100);
}

function rowToRecord(row: RunEventRow): RunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    stage: row.stage,
    label: row.label,
    model: row.model,
    refinerModel: row.refiner_model,
    durationMs: row.duration_ms,
    retryCount: row.retry_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    servedFromCache: row.served_from_cache === 1,
    usedLlm: row.used_llm === 1,
    summary: row.summary,
    costCents: row.cost_cents,
    createdAt: row.created_at,
  };
}

export interface RunHistoryRepository {
  record(input: PersistRunEventInput): RunEventRecord;
  list(options?: { projectId?: string; limit?: number }): RunEventRecord[];
  trend(days?: number): DailyRunCount[];
}

export function createRunHistoryRepository(
  db: Database.Database,
  ownerId: string,
): RunHistoryRepository {
  const insert = db.prepare(`
    INSERT INTO run_events (
      id, owner_id, run_id, project_id, stage, label, model, refiner_model,
      duration_ms, retry_count, input_tokens, output_tokens,
      served_from_cache, used_llm, summary, cost_cents, created_at
    ) VALUES (
      @id, @owner_id, @run_id, @project_id, @stage, @label, @model, @refiner_model,
      @duration_ms, @retry_count, @input_tokens, @output_tokens,
      @served_from_cache, @used_llm, @summary, @cost_cents, @created_at
    )
  `);
  const selectPrice = db.prepare(
    "SELECT usd_per_1k_input, usd_per_1k_output FROM model_prices WHERE model = ?",
  );
  const selectRecent = db.prepare(`
    SELECT * FROM run_events
     WHERE owner_id = @owner_id
       AND (@project_id IS NULL OR project_id = @project_id)
     ORDER BY created_at DESC
     LIMIT @limit
  `);
  const selectTrend = db.prepare(`
    SELECT
      substr(datetime(created_at / 1000, 'unixepoch'), 1, 10) AS day,
      COUNT(DISTINCT run_id) AS runs,
      COALESCE(SUM(cost_cents), 0) AS cost_cents
    FROM run_events
     WHERE owner_id = @owner_id AND created_at >= @since
     GROUP BY day
     ORDER BY day ASC
  `);

  function lookupPrice(
    model: string | undefined,
  ): { usdPer1kInput: number; usdPer1kOutput: number } | null {
    if (!model) return null;
    const exact = selectPrice.get(model) as PriceRow | undefined;
    if (exact) {
      return {
        usdPer1kInput: exact.usd_per_1k_input,
        usdPer1kOutput: exact.usd_per_1k_output,
      };
    }
    const alias = model.includes("/")
      ? model.slice(model.lastIndexOf("/") + 1)
      : model;
    const aliased = selectPrice.get(alias) as PriceRow | undefined;
    if (!aliased) return null;
    return {
      usdPer1kInput: aliased.usd_per_1k_input,
      usdPer1kOutput: aliased.usd_per_1k_output,
    };
  }

  return {
    record(input) {
      const now = input.now ?? Date.now();
      const telemetry = input.telemetry;
      const costCents = computeCostCents(
        telemetry.inputTokensEstimate,
        telemetry.outputTokensActual,
        lookupPrice(telemetry.modelName),
      );
      const record: RunEventRecord = {
        id: crypto.randomUUID(),
        runId: input.runId ?? crypto.randomUUID(),
        projectId: input.projectId ?? null,
        stage: telemetry.stage,
        label: telemetry.label,
        model: telemetry.modelName ?? null,
        refinerModel: telemetry.refinerModelName ?? null,
        durationMs: telemetry.durationMs,
        retryCount: telemetry.retryCount,
        inputTokens: telemetry.inputTokensEstimate,
        outputTokens: telemetry.outputTokensActual,
        servedFromCache: telemetry.servedFromCache,
        usedLlm: telemetry.usedLLM,
        summary: telemetry.summary,
        costCents,
        createdAt: now,
      };
      insert.run({
        id: record.id,
        owner_id: ownerId,
        run_id: record.runId,
        project_id: record.projectId,
        stage: record.stage,
        label: record.label,
        model: record.model,
        refiner_model: record.refinerModel,
        duration_ms: record.durationMs,
        retry_count: record.retryCount,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        served_from_cache: record.servedFromCache ? 1 : 0,
        used_llm: record.usedLlm ? 1 : 0,
        summary: record.summary,
        cost_cents: record.costCents,
        created_at: record.createdAt,
      });
      return record;
    },
    list(options = {}) {
      const rows = selectRecent.all({
        owner_id: ownerId,
        project_id: options.projectId ?? null,
        limit: options.limit ?? 100,
      }) as RunEventRow[];
      return rows.map(rowToRecord);
    },
    trend(days = 14) {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = selectTrend.all({ owner_id: ownerId, since }) as Array<{
        day: string;
        runs: number;
        cost_cents: number;
      }>;
      return rows.map((row) => ({
        day: row.day,
        runs: row.runs,
        costCents: row.cost_cents,
      }));
    },
  };
}
