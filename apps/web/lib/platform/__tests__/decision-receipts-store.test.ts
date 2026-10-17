// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  BACKENDS,
  openBackend,
  type BackendKind,
} from "../../../test-support/platform-backends";
import {
  createDecisionReceiptsStore,
  DECISION_RECEIPTS_SCHEMA_VERSION,
  type DecisionReceiptsStore,
  type RecordDecisionAnswerInput,
  type RecordDecisionCallInput,
} from "../decision-receipts-store";
import type { PlatformDb } from "../db";

// Same convention as repair-telemetry-store.test.ts: suites open the backend
// directly via platform-backends.ts, which exercises both the SQLite and the
// Postgres dialect against one store. (Since J5a1 the store is also reachable
// from the platform store — platform-backends.test.ts covers that wiring —
// but these suites keep the direct open so a wiring regression cannot mask a
// store bug.)
async function openStore(kind: BackendKind): Promise<{
  backend: Awaited<ReturnType<typeof openBackend>>;
  db: PlatformDb;
  store: DecisionReceiptsStore;
}> {
  const backend = await openBackend(kind);
  return {
    backend,
    db: backend.db,
    store: createDecisionReceiptsStore(backend.db),
  };
}

function answer(
  over: Partial<RecordDecisionAnswerInput> = {},
): RecordDecisionAnswerInput {
  return {
    questionIndex: 0,
    mode: "shadow",
    jevAnswer: "core",
    jevConfidence: 0.9,
    todayAnswer: "core",
    todaySource: "llm",
    agreement: true,
    ...over,
  };
}

function call(
  over: Partial<RecordDecisionCallInput> = {},
): RecordDecisionCallInput {
  return {
    use: "context-type",
    status: "advised",
    reviewer: true,
    model: "typesafe/jev-1.14",
    requestId: "req-1",
    generationId: "gen-1",
    costMicroUsd: 25,
    latencyMs: 210,
    now: Date.UTC(2026, 9, 16, 12, 0, 0),
    ...over,
  };
}

/** The daily-ceiling read must be measured against UTC midnight (invariant 6). */
const MIDDAY = Date.UTC(2026, 9, 16, 12, 0, 0);
const SAME_DAY_EARLIER = Date.UTC(2026, 9, 16, 1, 0, 0);
const YESTERDAY = Date.UTC(2026, 9, 15, 23, 0, 0);
const NEXT_DAY_MIDNIGHT_PLUS_1 = Date.UTC(2026, 9, 17, 0, 0, 1);

describe.each(BACKENDS)("decision receipts store (%s)", (kind) => {
  it("round-trips a call and its answers", async ({}) => {
    const { backend, store } = await openStore(kind);
    try {
      const now = MIDDAY;
      const recorded = await store.recordCall(call({ now }), [
        answer({ questionIndex: 0 }),
        answer({
          questionIndex: 1,
          jevAnswer: "supporting",
          todayAnswer: "core",
          todaySource: "heuristic",
          agreement: false,
        }),
      ]);
      expect(recorded.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(recorded).toMatchObject({
        use: "context-type",
        model: "typesafe/jev-1.14",
        requestId: "req-1",
        generationId: "gen-1",
        reviewer: true,
        costMicroUsd: 25,
        latencyMs: 210,
        status: "advised",
        createdAt: now,
      });

      const answers = await store.getAnswers(recorded.id);
      expect(answers).toHaveLength(2);
      expect(answers[0]).toEqual({
        callId: recorded.id,
        questionIndex: 0,
        mode: "shadow",
        jevAnswer: "core",
        jevConfidence: 0.9,
        todayAnswer: "core",
        todaySource: "llm",
        agreement: true,
        ownerReview: null,
      });
      expect(answers[1]).toMatchObject({
        questionIndex: 1,
        jevAnswer: "supporting",
        todayAnswer: "core",
        todaySource: "heuristic",
        agreement: false,
      });

      // A call that recorded nothing (an unknown result has no answers) is a
      // legal receipt: status carries the outcome.
      const unknown = await store.recordCall(
        call({ now, status: "timeout", costMicroUsd: null, latencyMs: null }),
        [],
      );
      expect(await store.getAnswers(unknown.id)).toEqual([]);
    } finally {
      await backend.close();
    }
  });

  it("the daily sum counts today's rows and excludes yesterday's", async ({}) => {
    const { backend, store } = await openStore(kind);
    try {
      await store.recordCall(call({ now: YESTERDAY, costMicroUsd: 100 }), []);
      await store.recordCall(call({ now: MIDDAY, costMicroUsd: 25 }), []);
      await store.recordCall(
        call({ now: SAME_DAY_EARLIER, costMicroUsd: 7 }),
        [],
      );
      // A call that cost nothing (unknown before dispatch) adds nothing.
      await store.recordCall(
        call({ now: MIDDAY, status: "budget", costMicroUsd: null }),
        [],
      );

      expect(await store.spentSinceUtcMidnight(MIDDAY)).toBe(32);
      // Midnight UTC rollover, not "last 24h": yesterday's row must not
      // re-enter the sum a minute past the next midnight.
      expect(await store.spentSinceUtcMidnight(NEXT_DAY_MIDNIGHT_PLUS_1)).toBe(
        0,
      );
    } finally {
      await backend.close();
    }
  });

  it("setOwnerReview writes the four closed-set values and refuses a missing row", async ({}) => {
    const { backend, store } = await openStore(kind);
    try {
      const recorded = await store.recordCall(call({ now: MIDDAY }), [
        answer({ questionIndex: 0, agreement: false }),
      ]);

      await store.setOwnerReview(recorded.id, 0, "llm_better");
      const [after] = await store.getAnswers(recorded.id);
      expect(after.ownerReview).toBe("llm_better");

      // A review written to a row that does not exist must be loud: it would
      // otherwise silently vanish from the agreement report the exit
      // criterion is counted from.
      await expect(
        store.setOwnerReview(recorded.id, 7, "llm_better"),
      ).rejects.toThrow(/no such answer row/);
      await expect(
        store.setOwnerReview(
          "99999999-9999-4999-8999-999999999999",
          0,
          "llm_better",
        ),
      ).rejects.toThrow(/no such answer row/);
    } finally {
      await backend.close();
    }
  });

  it("setOwnerReview refuses a non-reviewer call and a non-shadow answer row (J5b)", async ({}) => {
    const { backend, store } = await openStore(kind);
    try {
      // A non-reviewer generation's rows are invisible to the owner: he did
      // not watch that stream, so no verdict of his may land there.
      const notReviewer = await store.recordCall(
        call({ now: MIDDAY, reviewer: false }),
        [answer({ questionIndex: 0, agreement: false })],
      );
      await expect(
        store.setOwnerReview(notReviewer.id, 0, "llm_better"),
      ).rejects.toThrow(/not a reviewer call/);
      // ... and the refusal leaves the row untouched.
      expect((await store.getAnswers(notReviewer.id))[0].ownerReview).toBeNull();

      // Primary rows are not evidence for the shadow exit criterion, so a
      // verdict must not be written into the primary cohort either.
      const primary = await store.recordCall(call({ now: MIDDAY }), [
        answer({ questionIndex: 0, mode: "primary", agreement: false }),
      ]);
      await expect(
        store.setOwnerReview(primary.id, 0, "llm_better"),
      ).rejects.toThrow(/not in the shadow cohort/);
      expect((await store.getAnswers(primary.id))[0].ownerReview).toBeNull();

      // The same review value on a reviewer + shadow row still writes.
      const reviewer = await store.recordCall(call({ now: MIDDAY }), [
        answer({ questionIndex: 0, agreement: false }),
      ]);
      await store.setOwnerReview(reviewer.id, 0, "llm_better");
      expect((await store.getAnswers(reviewer.id))[0].ownerReview).toBe(
        "llm_better",
      );
    } finally {
      await backend.close();
    }
  });

  it("throws on any closed-set value outside its set, naming the field only", async ({}) => {
    const { backend, store } = await openStore(kind);
    try {
      const cases: Array<[string, RecordDecisionCallInput]> = [
        ["use", call({ use: "context-kind" as never })],
        ["status", call({ status: "exploded" as never })],
        ["reviewer", call({ reviewer: 1 as never })],
        ["model", call({ model: "the big model we used on Tuesday" })],
        ["requestId", call({ requestId: "acme/billing: request 3" })],
        ["generationId", call({ generationId: "gen; DROP TABLE x" })],
        ["costMicroUsd", call({ costMicroUsd: -5 })],
        ["costMicroUsd", call({ costMicroUsd: 1.5 })],
        ["latencyMs", call({ latencyMs: Number.NaN })],
      ];
      for (const [field, bad] of cases) {
        await expect(
          store.recordCall(bad, [answer()]),
          `${field} must be refused`,
        ).rejects.toThrow(new RegExp(`decision receipt rejected: ${field}`));
      }
      // The message names the field and never echoes the value.
      await expect(
        store.recordCall(call({ model: "the big model" }), []),
      ).rejects.toThrow(/model/);

      // Answer-level closed sets, including the per-use answer shape: U-C
      // answers are option INDICES, so a text option is refused, and so is a
      // non-canonical index.
      const indexUse = call({ use: "template-select" });
      await expect(
        store.recordCall(indexUse, [
          answer({ jevAnswer: "docker.node_version" }),
        ]),
      ).rejects.toThrow(/jevAnswer/);
      await expect(
        store.recordCall(indexUse, [answer({ jevAnswer: "01" })]),
      ).rejects.toThrow(/jevAnswer/);
      await expect(
        store.recordCall(call(), [answer({ jevAnswer: "0" })]),
      ).rejects.toThrow(/jevAnswer/); // "0" is not a context type
      await expect(
        store.recordCall(call(), [answer({ todaySource: "owner" as never })]),
      ).rejects.toThrow(/todaySource/);
      await expect(
        store.recordCall(call(), [answer({ mode: "review" as never })]),
      ).rejects.toThrow(/mode/);
      await expect(
        store.recordCall(call(), [answer({ jevConfidence: 1.2 })]),
      ).rejects.toThrow(/jevConfidence/);
      await expect(
        store.recordCall(call(), [answer(), answer({ questionIndex: 0 })]),
      ).rejects.toThrow(/questionIndex/);

      // The bad review enum is refused on the existing row too, not just on
      // the lookup.
      const recorded = await store.recordCall(call({ now: MIDDAY }), [
        answer({ questionIndex: 0 }),
      ]);
      await expect(
        store.setOwnerReview(recorded.id, 0, "jev_won" as never),
      ).rejects.toThrow(/review/);
    } finally {
      await backend.close();
    }
  });

  it("agreementReport counts by today_source, agreement and owner_review for one use in shadow mode", async ({}) => {
    const { backend, store } = await openStore(kind);
    try {
      // Two agreed LLM-baseline rows, one of them reviewed llm_better? No --
      // a disagreement is what gets reviewed; keep the sets disjoint and
      // assertable: 2 llm agreed, 1 llm disagreed (reviewed jev_better,
      // 1 still none), 1 heuristic disagreed (both_ok), 1 default agreed.
      const reviewedCall = await store.recordCall(call({ now: MIDDAY }), [
        answer({ questionIndex: 0 }),
        answer({
          questionIndex: 1,
          jevAnswer: "supporting",
          todayAnswer: "core",
          todaySource: "llm",
          agreement: false,
        }),
      ]);
      await store.setOwnerReview(reviewedCall.id, 1, "jev_better");

      await store.recordCall(call({ now: MIDDAY, generationId: "gen-2" }), [
        answer({ questionIndex: 0 }),
        answer({
          questionIndex: 1,
          jevAnswer: "generic",
          todayAnswer: "supporting",
          todaySource: "heuristic",
          agreement: false,
        }),
      ]);
      await store.recordCall(call({ now: MIDDAY, generationId: "gen-3" }), [
        answer({ questionIndex: 0, todaySource: "default" }),
      ]);

      const report = await store.agreementReport({
        use: "context-type",
        mode: "shadow",
      });
      expect(report).toEqual({
        total: 5,
        todaySource: { llm: 3, heuristic: 1, default: 1 },
        agreed: 3,
        disagreed: 2,
        ownerReview: {
          jev_better: 1,
          llm_better: 0,
          both_ok: 0,
          both_wrong: 0,
          none: 4,
        },
        llmCohort: { total: 3, agreed: 2, disagreed: 1 },
        // call() defaults to reviewer: true, so every llm row is in the
        // reviewer cohort here.
        reviewerCohort: 3,
      });

      // Scoped to the use: template-select rows must not bleed into the
      // context-type cohort (and its answers are indices, not types).
      await store.recordCall(
        call({
          now: MIDDAY,
          use: "template-select",
          generationId: "gen-4",
        }),
        [
          answer({
            questionIndex: 0,
            jevAnswer: "1",
            todayAnswer: "2",
            todaySource: "default",
            agreement: false,
          }),
        ],
      );
      const scoped = await store.agreementReport({
        use: "context-type",
        mode: "shadow",
      });
      expect(scoped.total).toBe(5);
      const templateReport = await store.agreementReport({
        use: "template-select",
        mode: "shadow",
      });
      expect(templateReport).toEqual({
        total: 1,
        todaySource: { llm: 0, heuristic: 0, default: 1 },
        agreed: 0,
        disagreed: 1,
        ownerReview: {
          jev_better: 0,
          llm_better: 0,
          both_ok: 0,
          both_wrong: 0,
          none: 1,
        },
        llmCohort: { total: 0, agreed: 0, disagreed: 0 },
        reviewerCohort: 0,
      });

      // The reviewer cohort counts ONLY llm rows from reviewer calls: a
      // non-reviewer call's llm rows count toward the llm total but not the
      // reviewer floor, and heuristic rows never count either way.
      await store.recordCall(
        call({ now: MIDDAY, reviewer: false, generationId: "gen-5" }),
        [answer({ questionIndex: 0, agreement: false })],
      );
      await store.recordCall(
        call({ now: MIDDAY, reviewer: false, generationId: "gen-6" }),
        [
          answer({
            questionIndex: 0,
            todaySource: "heuristic",
            agreement: false,
          }),
        ],
      );
      const floors = await store.agreementReport({
        use: "context-type",
        mode: "shadow",
      });
      expect(floors.todaySource.llm).toBe(4);
      expect(floors.llmCohort.disagreed).toBe(2);
      expect(floors.reviewerCohort).toBe(3);

      // The report reads only this schema version's rows, and only shadow:
      // primary rows are not evidence for the shadow exit criterion.
      await expect(
        store.agreementReport({
          use: "context-type",
          mode: "primary" as never,
        }),
      ).rejects.toThrow(/mode/);
      await expect(
        store.agreementReport({ use: "context-kind" as never, mode: "shadow" }),
      ).rejects.toThrow(/use/);
    } finally {
      await backend.close();
    }
  });

  it("hides rows written under a foreign schema_version from the report", async ({}) => {
    const { backend, db, store } = await openStore(kind);
    try {
      // A row from a different deploy, inserted directly: reads must not
      // decode it (discard-don't-migrate, same rule as repair telemetry).
      await db.run(
        `INSERT INTO decision_calls (
           id, schema_version, created_at, use, model, request_id,
           generation_id, reviewer, cost_micro_usd, latency_ms, status
         ) VALUES (
           '99999999-9999-4999-8999-999999999999', 99, hx_ts(@at), 'context-type', '', '', '', ${kind === "postgres" ? "FALSE" : "0"}, 10, 10, 'advised'
         )`,
        { at: MIDDAY },
      );
      const report = await store.agreementReport({
        use: "context-type",
        mode: "shadow",
      });
      expect(report.total).toBe(0);
      // ... but its cost still counts against the ceiling: money was spent
      // whoever wrote the row.
      expect(await store.spentSinceUtcMidnight(MIDDAY)).toBe(10);
      expect(DECISION_RECEIPTS_SCHEMA_VERSION).toBe(1);
    } finally {
      await backend.close();
    }
  });
});
