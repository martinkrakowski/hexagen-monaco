import type { PlatformDb } from "./db";

/**
 * Decision receipts for the Jev decision-advice port (Jev J1c).
 *
 * PURPOSE: this store is the measurement baseline for the shadow-first
 * rollout (invariant 2 of docs/planning/2026-10-16-jev-decision-advice.md).
 * A use may leave shadow mode only when its exit criterion is met and that
 * criterion is counted from these tables, so a write that silently distorted
 * a row would be the one failure this store cannot be allowed to produce.
 *
 * ============================================================================
 * RETENTION CONTRACT -- READ BEFORE ADDING A COLUMN
 * ============================================================================
 * Same contract as repair-telemetry-store.ts, restated because the tables it
 * protects are new:
 *
 * Shipped UI copy promises the user that their source is not kept, and a
 * manifest's bounded-context, port and adapter names are the user's own
 * domain vocabulary lifted out of their repository. Persisting any of it
 * breaks that promise as surely as persisting a file would.
 *
 * Therefore EVERY column in both tables below is one of:
 *   - an integer count, duration, cost or 0/1 boolean;
 *   - a member of a CLOSED string set declared in this file;
 *   - an opaque, store-validated identifier (see `requestId` / `generationId`).
 *
 * Never stored: state text, context names, project text, the key, any user
 * id. There is no owner_id column at all -- the reviewer's identity is
 * reduced to a boolean (`reviewer = sub === JEV_REVIEWER_SUB`) before the
 * write, and an owner column here would be a user id by another name. The
 * daily-spend ceiling and the agreement report are deployment-wide
 * measurements, not per-owner data.
 *
 * Answers are a context type (U-A) or an option INDEX (U-C), never question
 * text, option text or a free-text answer. The only nullable column is
 * `owner_review`: it is written later, by the owner-review route (J5b).
 *
 * RESIDUAL, stated honestly: `generation_id` correlates rows written by one
 * generation run, and the SET of answers in one call says something like
 * "this manifest had two flagged contexts". That is coarse shape, not
 * content -- no combination of rows reconstructs YAML or names a context.
 *
 * STRUCTURED LOG: a caller (J5a) mirrors each call in a structured log line;
 * these tables hold the durable half only.
 */

/**
 * Bump when the persisted row shape changes in a way an older reader would
 * misread. Same discard-don't-migrate rule as repair-telemetry-store: these
 * rows are DERIVED telemetry. Reads gate on `schema_version =
 * DECISION_RECEIPTS_SCHEMA_VERSION` in SQL, so a row written by a different
 * deploy is invisible rather than half-decoded.
 *
 * EXCEPTION -- the daily ceiling (invariant 6) does NOT gate on
 * schema_version: money was spent whoever wrote the row, and a version bump
 * must not reset the ceiling.
 */
export const DECISION_RECEIPTS_SCHEMA_VERSION = 1;

/** Which decision advice use produced the call. Mirrors the plan's U-A / U-C. */
export const DECISION_USES = ["context-type", "template-select"] as const;
export type DecisionUse = (typeof DECISION_USES)[number];

/** Which engine's answer the product used; shadow mode always uses today's. */
export const DECISION_MODES = ["shadow", "primary"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

/** Where today's answer came from (invariant 2's "today's result"). */
export const DECISION_TODAY_SOURCES = ["llm", "heuristic", "default"] as const;
export type DecisionTodaySource = (typeof DECISION_TODAY_SOURCES)[number];

/** The owner's verdict on one disagreement, via the J5b route. */
export const DECISION_OWNER_REVIEWS = [
  "jev_better",
  "llm_better",
  "both_ok",
  "both_wrong",
] as const;
export type DecisionOwnerReview = (typeof DECISION_OWNER_REVIEWS)[number];

/**
 * The five bounded-context types, verbatim from
 * classify-context-type.prompt.ts. Duplicated rather than imported so this
 * store stays free of a domain-package dependency, same reasoning as
 * REPAIR_GATE_REASONS in repair-telemetry-store.ts: a drift in the source
 * union surfaces as a rejected write, not a silent free-text column.
 */
export const DECISION_CONTEXT_TYPES = [
  "core",
  "supporting",
  "generic",
  "shared-kernel",
  "driver",
] as const;
export type DecisionContextType = (typeof DECISION_CONTEXT_TYPES)[number];

/**
 * `status` is `advised` or the `unknown` reason. Duplicated from
 * DecisionUnknownReason (decision-advice.types.ts) for the same
 * no-domain-dependency reason; an added reason in the port fails writes here
 * until this set is extended, which is the loud direction to fail in.
 */
export const DECISION_UNKNOWN_REASONS = [
  "disabled",
  "refused",
  "budget",
  "timeout",
  "http",
  "shape",
  "tie",
  "error",
] as const;
export type DecisionUnknownReason = (typeof DECISION_UNKNOWN_REASONS)[number];
export type DecisionCallStatus = "advised" | DecisionUnknownReason;

/**
 * Answers per call are bounded because a U-A call batches one question per
 * flagged context: a pathological generation must not fill the volume with
 * one row per context it produced.
 */
export const MAX_DECISION_ANSWERS_PER_CALL = 200;

function isDecisionUse(value: unknown): value is DecisionUse {
  return (
    typeof value === "string" &&
    (DECISION_USES as readonly string[]).includes(value)
  );
}

function isDecisionMode(value: unknown): value is DecisionMode {
  return (
    typeof value === "string" &&
    (DECISION_MODES as readonly string[]).includes(value)
  );
}

function isDecisionTodaySource(value: unknown): value is DecisionTodaySource {
  return (
    typeof value === "string" &&
    (DECISION_TODAY_SOURCES as readonly string[]).includes(value)
  );
}

function isDecisionOwnerReview(value: unknown): value is DecisionOwnerReview {
  return (
    typeof value === "string" &&
    (DECISION_OWNER_REVIEWS as readonly string[]).includes(value)
  );
}

function isDecisionStatus(value: unknown): value is DecisionCallStatus {
  return (
    value === "advised" ||
    (typeof value === "string" &&
      (DECISION_UNKNOWN_REASONS as readonly string[]).includes(value))
  );
}

/**
 * An answer value is a closed-set member whose set depends on the use:
 *   - `context-type` (U-A): one of the five context types;
 *   - `template-select` (U-C): an option INDEX, stored as its canonical
 *     decimal string (`"0"`, `"1"`, ... -- never `"01"` or `" 1"`).
 */
function isDecisionAnswer(use: DecisionUse, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (use === "context-type") {
    return (DECISION_CONTEXT_TYPES as readonly string[]).includes(value);
  }
  return /^(0|[1-9]\d{0,2})$/.test(value);
}

/**
 * Opaque identifiers and model ids: an empty string means "not supplied" /
 * "no call was made" (mirrors DecisionReceipt), and a non-empty value must be
 * a bounded identifier with no whitespace or control characters. `"acme/
 * billing"` and `"typesafe/jev-1.14"` both pass; a pasted sentence does not.
 */
const IDENTIFIER = /^(?:|[A-Za-z0-9][A-Za-z0-9._:/-]{0,127})$/;

function isIdentifier(value: unknown): boolean {
  return typeof value === "string" && IDENTIFIER.test(value);
}

/** A non-negative, finite integer; anything else means the accounting is broken. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A nullable non-negative, finite integer (cost / latency). */
function isOptionalCount(value: unknown): value is number | null {
  return value === null || value === undefined || isCount(value);
}

/** A confidence in 0..1; outside that, the row would lie about what Jev said. */
function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export interface RecordDecisionCallInput {
  readonly use: DecisionUse;
  /** `advised` or the `unknown` reason; the receipt's status verbatim. */
  readonly status: DecisionCallStatus;
  /** True only for the reviewer's own generations (sub === JEV_REVIEWER_SUB). */
  readonly reviewer: boolean;
  /** Model identifier, or "" when no call was made. */
  readonly model?: string;
  /** Provider call id, or "" when no call was made. */
  readonly requestId?: string;
  /** Caller-minted generation id, or "" when not supplied. */
  readonly generationId?: string;
  /** Call cost in micro-USD, or null when unknown. */
  readonly costMicroUsd?: number | null;
  /** Call latency in milliseconds, or null when unknown. */
  readonly latencyMs?: number | null;
  readonly now?: number;
}

export interface RecordDecisionAnswerInput {
  /** 0-based index of the question within the call (`c0…cn` -> 0…n). */
  readonly questionIndex: number;
  readonly mode: DecisionMode;
  /** A context type (U-A) or an option index as a canonical decimal string (U-C). */
  readonly jevAnswer: string;
  /** 0..1, the answer validator's confidence. */
  readonly jevConfidence: number;
  /** Today's answer, same closed set as `jevAnswer` for the use. */
  readonly todayAnswer: string;
  readonly todaySource: DecisionTodaySource;
  /** jev_answer === today_answer, decided by the CALLER and recorded here. */
  readonly agreement: boolean;
}

export interface DecisionCallRecord {
  readonly id: string;
  readonly use: DecisionUse;
  readonly model: string;
  readonly requestId: string;
  readonly generationId: string;
  readonly reviewer: boolean;
  readonly costMicroUsd: number | null;
  readonly latencyMs: number | null;
  readonly status: DecisionCallStatus;
  readonly createdAt: number;
}

export interface DecisionAnswerRecord {
  readonly callId: string;
  readonly questionIndex: number;
  readonly mode: DecisionMode;
  readonly jevAnswer: string;
  readonly jevConfidence: number;
  readonly todayAnswer: string;
  readonly todaySource: DecisionTodaySource;
  readonly agreement: boolean;
  readonly ownerReview: DecisionOwnerReview | null;
}

export interface DecisionAgreementReport {
  /** Answers counted, after the use / mode / schema-version filters. */
  readonly total: number;
  /** Counts by today_source; the exit criterion counts the `llm` cohort. */
  readonly todaySource: Record<DecisionTodaySource, number>;
  /** Answers where jev_answer matched today_answer, and the rest. */
  readonly agreed: number;
  readonly disagreed: number;
  /** Owner reviews so far; `none` counts rows still awaiting review. */
  readonly ownerReview: Record<DecisionOwnerReview | "none", number>;
}

interface DecisionCallRow {
  id: string;
  schema_version: number;
  created_at: number;
  use: string;
  model: string;
  request_id: string;
  generation_id: string;
  reviewer: number | boolean;
  cost_micro_usd: number | null;
  latency_ms: number | null;
  status: string;
}

interface DecisionAnswerRow {
  call_id: string;
  question_index: number;
  mode: string;
  jev_answer: string;
  jev_confidence: number;
  today_answer: string;
  today_source: string;
  agreement: number | boolean;
  owner_review: string | null;
}

const CALL_COLUMNS = `
  id, schema_version, hx_ms(created_at) AS created_at, use, model, request_id,
  generation_id, reviewer, cost_micro_usd, latency_ms, status
`;

const ANSWER_COLUMNS = `
  call_id, question_index, mode, jev_answer, jev_confidence, today_answer,
  today_source, agreement, owner_review
`;

/**
 * Unlike repair-telemetry-store, this store THROWS on rejected input rather
 * than returning a PersistenceError result: the brief for J1c says "validate
 * every closed-set value at the store boundary and throw on anything else".
 * The message names the FIELD and never echoes the rejected value -- an error
 * string that quoted a bad answer would put the exact content this store
 * refuses to keep into a log line, and error strings travel further than rows.
 */
function rejected(field: string, reason: string): never {
  throw new Error(`decision receipt rejected: ${field} ${reason}`);
}

function flag(value: number | boolean): boolean {
  return value === 1 || value === true;
}

function callRowToRecord(row: DecisionCallRow): DecisionCallRecord | null {
  if (!isDecisionUse(row.use)) return null;
  if (!isDecisionStatus(row.status)) return null;
  return {
    id: row.id,
    use: row.use,
    model: row.model,
    requestId: row.request_id,
    generationId: row.generation_id,
    reviewer: flag(row.reviewer),
    costMicroUsd: row.cost_micro_usd,
    latencyMs: row.latency_ms,
    status: row.status,
    createdAt: Number(row.created_at),
  };
}

function answerRowToRecord(
  row: DecisionAnswerRow,
): DecisionAnswerRecord | null {
  if (!isDecisionMode(row.mode)) return null;
  if (!isDecisionTodaySource(row.today_source)) return null;
  if (row.owner_review !== null && !isDecisionOwnerReview(row.owner_review)) {
    return null;
  }
  return {
    callId: row.call_id,
    questionIndex: row.question_index,
    mode: row.mode,
    jevAnswer: row.jev_answer,
    jevConfidence: row.jev_confidence,
    todayAnswer: row.today_answer,
    todaySource: row.today_source,
    agreement: flag(row.agreement),
    ownerReview: row.owner_review,
  };
}

export interface DecisionReceiptsStore {
  /**
   * Write one call and its answers as a single transaction. Answers are
   * never written without their call: an answer row whose call row is
   * missing cannot be counted or reviewed, i.e. a row that can only be
   * read wrongly.
   *
   * Throws on any input outside the closed sets or identifier shapes above,
   * naming the field but never the value.
   */
  recordCall(
    call: RecordDecisionCallInput,
    answers: readonly RecordDecisionAnswerInput[],
  ): Promise<DecisionCallRecord>;
  /**
   * The invariant-6 ceiling read: the sum of `cost_micro_usd` over rows with
   * `created_at` since midnight UTC of `now`, in micro-USD. Not gated on
   * schema_version -- see the comment there.
   */
  spentSinceUtcMidnight(now: number): Promise<number>;
  /**
   * Record the owner's verdict on one answer row. Accepts only the four
   * closed-set values; throws on anything else and on a row that does not
   * exist (a review written to no row would silently disappear from the
   * report, which is worse than a loud failure).
   */
  setOwnerReview(
    callId: string,
    questionIndex: number,
    review: DecisionOwnerReview,
  ): Promise<void>;
  /** Answers for one call, in question order. Round-trip / J5b lookup read. */
  getAnswers(callId: string): Promise<DecisionAnswerRecord[]>;
  /**
   * The exit-criterion read: counts by today_source, agreement and
   * owner_review for one use in shadow mode. Rows whose mode is not the
   * requested one are excluded in SQL, and a use outside the closed set is
   * rejected here rather than reported as an empty cohort.
   */
  agreementReport(options: {
    use: DecisionUse;
    /** Only shadow counts today; the type admits it and the runtime enforces it. */
    mode: "shadow";
  }): Promise<DecisionAgreementReport>;
}

export function createDecisionReceiptsStore(
  db: PlatformDb,
): DecisionReceiptsStore {
  const insertCall = `
    INSERT INTO decision_calls (
      id, schema_version, created_at, use, model, request_id, generation_id,
      reviewer, cost_micro_usd, latency_ms, status
    ) VALUES (
      @id, @schema_version, hx_ts(@created_at), @use, @model, @request_id,
      @generation_id, @reviewer, @cost_micro_usd, @latency_ms, @status
    )
  `;

  const insertAnswer = `
    INSERT INTO decision_answers (
      call_id, question_index, mode, jev_answer, jev_confidence,
      today_answer, today_source, agreement, owner_review
    ) VALUES (
      @call_id, @question_index, @mode, @jev_answer, @jev_confidence,
      @today_answer, @today_source, @agreement, @owner_review
    )
  `;

  const selectAnswers = `
    SELECT ${ANSWER_COLUMNS} FROM decision_answers
     WHERE call_id = @call_id
     ORDER BY question_index ASC
  `;

  const selectAgreementGroups = `
    SELECT a.today_source AS today_source, a.agreement AS agreement,
           a.owner_review AS owner_review, COUNT(*) AS n
      FROM decision_answers a
      JOIN decision_calls c ON c.id = a.call_id
     WHERE c.schema_version = @schema_version
       AND c.use = @use
       AND a.mode = @mode
     GROUP BY a.today_source, a.agreement, a.owner_review
  `;

  const updateOwnerReview = `
    UPDATE decision_answers SET owner_review = @review
     WHERE call_id = @call_id AND question_index = @question_index
  `;

  const selectSpend = `
    SELECT COALESCE(SUM(cost_micro_usd), 0) AS spent
      FROM decision_calls
     WHERE created_at >= hx_ts(@since)
  `;

  return {
    async recordCall(call, answers) {
      if (!isDecisionUse(call?.use)) {
        rejected("use", "is not a known decision-advice use");
      }
      if (!isDecisionStatus(call?.status)) {
        rejected("status", "is not advised or a known unknown reason");
      }
      if (typeof call?.reviewer !== "boolean") {
        rejected("reviewer", "is not a boolean");
      }
      if (!isIdentifier(call?.model)) {
        rejected("model", "is empty or not a bounded identifier");
      }
      if (!isIdentifier(call?.requestId)) {
        rejected("requestId", "is empty or not a bounded identifier");
      }
      if (!isIdentifier(call?.generationId)) {
        rejected("generationId", "is empty or not a bounded identifier");
      }
      if (!isOptionalCount(call?.costMicroUsd)) {
        rejected("costMicroUsd", "is not null or a non-negative integer");
      }
      if (!isOptionalCount(call?.latencyMs)) {
        rejected("latencyMs", "is not null or a non-negative integer");
      }

      const list = Array.isArray(answers) ? answers : [];
      if (list.length > MAX_DECISION_ANSWERS_PER_CALL) {
        rejected("answers", `exceed ${MAX_DECISION_ANSWERS_PER_CALL} per call`);
      }

      const now = call.now ?? Date.now();
      const seen = new Set<number>();
      const answerParams: Array<Record<string, string | number | null>> = [];
      for (const answer of list) {
        if (!isDecisionMode(answer?.mode)) {
          rejected("answer mode", "is not shadow or primary");
        }
        if (!isCount(answer?.questionIndex)) {
          rejected("answer questionIndex", "is not a non-negative integer");
        }
        if (seen.has(answer.questionIndex)) {
          rejected("answers", "contain a duplicate questionIndex");
        }
        seen.add(answer.questionIndex);
        if (!isDecisionAnswer(call.use, answer.jevAnswer)) {
          rejected("answer jevAnswer", "is outside the closed set for the use");
        }
        if (!isConfidence(answer?.jevConfidence)) {
          rejected("answer jevConfidence", "is not a number in 0..1");
        }
        if (!isDecisionAnswer(call.use, answer.todayAnswer)) {
          rejected(
            "answer todayAnswer",
            "is outside the closed set for the use",
          );
        }
        if (!isDecisionTodaySource(answer?.todaySource)) {
          rejected("answer todaySource", "is not llm, heuristic or default");
        }
        if (typeof answer?.agreement !== "boolean") {
          rejected("answer agreement", "is not a boolean");
        }
        answerParams.push({
          call_id: null, // replaced inside the transaction with the call id
          question_index: answer.questionIndex,
          mode: answer.mode,
          jev_answer: answer.jevAnswer,
          jev_confidence: answer.jevConfidence,
          today_answer: answer.todayAnswer,
          today_source: answer.todaySource,
          agreement: answer.agreement ? 1 : 0,
          owner_review: null,
        });
      }

      const id = crypto.randomUUID();
      const callParams: Record<string, string | number | null> = {
        id,
        schema_version: DECISION_RECEIPTS_SCHEMA_VERSION,
        created_at: now,
        use: call.use,
        model: call.model ?? "",
        request_id: call.requestId ?? "",
        generation_id: call.generationId ?? "",
        reviewer: call.reviewer ? 1 : 0,
        cost_micro_usd: call.costMicroUsd ?? null,
        latency_ms: call.latencyMs ?? null,
        status: call.status,
      };

      try {
        await db.transaction(async (tx) => {
          await tx.run(insertCall, callParams);
          for (const answer of answerParams) {
            await tx.run(insertAnswer, {
              ...answer,
              call_id: id,
            });
          }
        });
      } catch (cause) {
        // The message stays closed-set: it must not quote the rejected input
        // (see `rejected`), and a constraint failure names the table only.
        throw new Error("Failed to persist decision receipt", { cause });
      }

      const record: DecisionCallRecord = {
        id,
        use: call.use,
        model: call.model ?? "",
        requestId: call.requestId ?? "",
        generationId: call.generationId ?? "",
        reviewer: call.reviewer,
        costMicroUsd: call.costMicroUsd ?? null,
        latencyMs: call.latencyMs ?? null,
        status: call.status,
        createdAt: now,
      };
      return record;
    },

    async spentSinceUtcMidnight(now) {
      if (!isCount(now)) {
        rejected("now", "is not a non-negative epoch-millisecond number");
      }
      const day = new Date(now);
      const since = Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
      );
      const row = await db.get<{ spent: number | string | null }>(selectSpend, {
        since,
      });
      const spent = Number(row?.spent ?? 0);
      return Number.isFinite(spent) && spent > 0 ? spent : 0;
    },

    async setOwnerReview(callId, questionIndex, review) {
      if (!isIdentifier(callId) || callId === "") {
        rejected("callId", "is not a bounded identifier");
      }
      if (!isCount(questionIndex)) {
        rejected("questionIndex", "is not a non-negative integer");
      }
      if (!isDecisionOwnerReview(review)) {
        rejected("review", "is not one of the four owner-review values");
      }
      const result = await db.run(updateOwnerReview, {
        call_id: callId,
        question_index: questionIndex,
        review,
      });
      if (result.changes === 0) {
        // Deliberately does not echo callId -- see `rejected`.
        throw new Error("decision receipt rejected: no such answer row");
      }
    },

    async getAnswers(callId) {
      if (!isIdentifier(callId) || callId === "") {
        rejected("callId", "is not a bounded identifier");
      }
      const rows = (await db.all<DecisionAnswerRow>(selectAnswers, {
        call_id: callId,
      })) as DecisionAnswerRow[];
      const records: DecisionAnswerRecord[] = [];
      for (const row of rows) {
        const record = answerRowToRecord(row);
        if (record !== null) records.push(record);
      }
      return records;
    },

    async agreementReport(options) {
      if (!isDecisionUse(options?.use)) {
        rejected("use", "is not a known decision-advice use");
      }
      if (options?.mode !== "shadow") {
        rejected("mode", 'is not "shadow"');
      }
      const rows = await db.all<{
        today_source: string;
        agreement: number | boolean;
        owner_review: string | null;
        n: number;
      }>(selectAgreementGroups, {
        schema_version: DECISION_RECEIPTS_SCHEMA_VERSION,
        use: options.use,
        mode: options.mode,
      });

      // A mutable accumulator: the returned type is the readonly
      // DecisionAgreementReport, so the counts are built up here and handed
      // over frozen-by-convention.
      const report = {
        total: 0,
        todaySource: { llm: 0, heuristic: 0, default: 0 },
        agreed: 0,
        disagreed: 0,
        ownerReview: {
          jev_better: 0,
          llm_better: 0,
          both_ok: 0,
          both_wrong: 0,
          none: 0,
        },
      };
      for (const row of rows) {
        if (!isDecisionTodaySource(row.today_source)) continue;
        if (
          row.owner_review !== null &&
          !isDecisionOwnerReview(row.owner_review)
        ) {
          continue;
        }
        const n = Number(row.n);
        if (!Number.isFinite(n) || n <= 0) continue;
        report.total += n;
        report.todaySource[row.today_source] += n;
        if (flag(row.agreement)) {
          report.agreed += n;
        } else {
          report.disagreed += n;
        }
        report.ownerReview[row.owner_review ?? "none"] += n;
      }
      return report;
    },
  };
}
