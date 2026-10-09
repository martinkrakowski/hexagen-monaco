import type { PlatformDb } from "./db";

export interface StageTelemetryInput {
  stage: number;
  label: string;
  durationMs: number;
  usedLLM: boolean;
  retryCount: number;
  inputTokensEstimate: number;
  outputTokensActual: number;
  servedFromCache: boolean;
  /**
   * Counts / flags / closed-set phrases only — NEVER user content. This is the
   * READ side of the boundary and stays `string` on purpose: the value arrives
   * as JSON over `/api/runs` (`z.string()`), so nothing here can re-derive a
   * brand. Enforcement lives on the WRITE side, where the value is built:
   * `StageTelemetry.summary` in @hexagen/agentic-interaction is a branded
   * `StageSummary` obtainable only from the `stageSummary` tagged template,
   * whose interpolation slots refuse `string`. See that type's doc, and
   * `repair-telemetry-store.ts` for the same retention contract stated in
   * full. A `run_events.summary` that quotes a prompt breaks the shipped
   * "nothing was kept" promise as surely as storing the prompt would.
   */
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

const RUN_EVENT_COLUMNS =
  "id, run_id, project_id, stage, label, model, refiner_model, duration_ms, retry_count, input_tokens, output_tokens, served_from_cache, used_llm, summary, cost_cents, hx_ms(created_at) AS created_at";

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
  record(input: PersistRunEventInput): Promise<RunEventRecord>;
  list(options?: {
    projectId?: string;
    limit?: number;
  }): Promise<RunEventRecord[]>;
  trend(days?: number): Promise<DailyRunCount[]>;
}

export function createRunHistoryRepository(
  db: PlatformDb,
  ownerId: string,
): RunHistoryRepository {
  const insert = `
    INSERT INTO run_events (
      id, owner_id, run_id, project_id, stage, label, model, refiner_model,
      duration_ms, retry_count, input_tokens, output_tokens,
      served_from_cache, used_llm, summary, cost_cents, created_at
    ) VALUES (
      @id, @owner_id, @run_id, @project_id, @stage, @label, @model, @refiner_model,
      @duration_ms, @retry_count, @input_tokens, @output_tokens,
      @served_from_cache, @used_llm, @summary, @cost_cents, hx_ts(@created_at)
     )
    ON CONFLICT(owner_id, run_id, stage) DO UPDATE SET
      project_id = excluded.project_id,
      label = excluded.label,
      model = excluded.model,
      refiner_model = excluded.refiner_model,
      duration_ms = excluded.duration_ms,
      retry_count = excluded.retry_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      served_from_cache = excluded.served_from_cache,
      used_llm = excluded.used_llm,
      summary = excluded.summary,
      cost_cents = excluded.cost_cents,
      created_at = excluded.created_at
     RETURNING ${RUN_EVENT_COLUMNS}
  `;
  const selectPrice =
    "SELECT usd_per_1k_input, usd_per_1k_output FROM model_prices WHERE model = ?";
  const selectRecent = `
    SELECT ${RUN_EVENT_COLUMNS} FROM run_events
     WHERE owner_id = @owner_id
       AND (CAST(@project_id AS TEXT) IS NULL OR project_id = @project_id)
     ORDER BY created_at DESC
     LIMIT @limit
  `;
  const selectTrend = `
    SELECT
      hx_day(created_at) AS day,
      COUNT(DISTINCT run_id) AS runs,
      COALESCE(SUM(cost_cents), 0) AS cost_cents
    FROM run_events
     WHERE owner_id = @owner_id AND created_at >= hx_ts(@since)
     GROUP BY day
     ORDER BY day ASC
  `;

  async function lookupPrice(
    model: string | undefined,
  ): Promise<{ usdPer1kInput: number; usdPer1kOutput: number } | null> {
    if (!model) return null;
    const exact = await db.get<PriceRow>(selectPrice, [model]);
    if (exact) {
      return {
        usdPer1kInput: exact.usd_per_1k_input,
        usdPer1kOutput: exact.usd_per_1k_output,
      };
    }
    const alias = model.includes("/")
      ? model.slice(model.lastIndexOf("/") + 1)
      : model;
    const aliased = await db.get<PriceRow>(selectPrice, [alias]);
    if (!aliased) return null;
    return {
      usdPer1kInput: aliased.usd_per_1k_input,
      usdPer1kOutput: aliased.usd_per_1k_output,
    };
  }

  return {
    async record(input) {
      const now = input.now ?? Date.now();
      const telemetry = input.telemetry;
      const costCents = computeCostCents(
        telemetry.inputTokensEstimate,
        telemetry.outputTokensActual,
        await lookupPrice(telemetry.modelName),
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
      const stored = (await db.get<RunEventRow>(insert, {
        id: record.id,
        owner_id: ownerId,
        run_id: record.runId,
        project_id: record.projectId,
        stage: record.stage,
        label: record.label,
        model: record.model,
        refiner_model: record.refinerModel,
        duration_ms: Math.round(record.durationMs),
        retry_count: Math.round(record.retryCount),
        input_tokens: Math.round(record.inputTokens),
        output_tokens: Math.round(record.outputTokens),
        served_from_cache: record.servedFromCache ? 1 : 0,
        used_llm: record.usedLlm ? 1 : 0,
        summary: record.summary,
        cost_cents: record.costCents,
        created_at: record.createdAt,
      }))!;
      return rowToRecord(stored);
    },
    async list(options = {}) {
      const rows = await db.all<RunEventRow>(selectRecent, {
        owner_id: ownerId,
        project_id: options.projectId ?? null,
        limit: options.limit ?? 100,
      });
      return rows.map(rowToRecord);
    },
    async trend(days = 14) {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = await db.all<{
        day: string;
        runs: number;
        cost_cents: number;
      }>(selectTrend, { owner_id: ownerId, since });
      return rows.map((row) => ({
        day: row.day,
        runs: row.runs,
        costCents: row.cost_cents,
      }));
    },
  };
}
