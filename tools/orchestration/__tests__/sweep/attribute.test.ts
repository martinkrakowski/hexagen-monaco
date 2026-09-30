import { describe, expect, test } from "vitest";
import {
  ATTRIBUTE_USAGE,
  parseAttributeArgs,
} from "../../src/sweep/lib/args.js";
import { decodeRunLog, RUN_LIST_LIMIT } from "../../src/sweep/lib/attribute.js";
import { runCli, type SweepCliIo } from "../../src/sweep/cli.js";
import { harness } from "./support.js";

/**
 * Attribution: which review-agent workflow raised which review thread.
 *
 * Ported from the source suite. The only fixture changed is the path inside
 * the model response, which at the source named a specific repository's
 * directory layout and is now an invented one — the test never reads it, it
 * only needs text for the log to contain.
 */

/** Longer than the 80-char excerpt, so matching the excerpt cannot succeed. */
const SUGGESTION_API =
  "Throw a proper `Error` object instead of a raw string so the error handling middleware treats it as a server error and preserves stack traces.";

const WORKFLOW = {
  UI: "PR-Agent UI Review",
  API: "PR-Agent API Review",
  Architecture: "PR-Agent Architecture Review",
} as const;

/** Default `headSha` / commit oid the stub ties to the PR unless a test overrides. */
const DEFAULT_HEAD = "sha-this-pr";

/** U+2011 NON-BREAKING HYPHEN — the character the review agent puts in `cache‑key`. */
const NBH = "‑";

function suggestionBody(
  text: string,
  label = "critical bug",
  importance = 4,
): string {
  return `**Suggestion:** ${text} [${label}, importance: ${importance}]`;
}

function threadNode(
  id: string,
  isResolved: boolean,
  author: string,
  body: string,
): Record<string, unknown> {
  return {
    id,
    isResolved,
    comments: { nodes: [{ author: { login: author }, body }] },
  };
}

function threadPage(nodes: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: "PR_I_1",
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes,
          },
        },
      },
    },
  });
}

/**
 * A job-log line in the shape `gh run view --log` actually writes: a prefix,
 * then a JSON object whose `text` field is JSON-escaped (`\n`, `\"`).
 */
function aiLog(suggestion: string): string {
  const text = `\nAI response:\n\`\`\`yaml\ncode_suggestions:\n- relevant_file: |\n    packages/web/src/render/panel.ts\n  suggestion_content: |\n    ${suggestion}\n`;
  return `PR-Agent review\tUNKNOWN STEP\t2026-09-14T20:45:58.0033196Z ${JSON.stringify({ text })}`;
}

function workflowOf(args: readonly string[]): string {
  const i = args.indexOf("--workflow");
  return i >= 0 ? String(args[i + 1]) : "";
}

interface StubOpts {
  readonly nodes?: readonly Record<string, unknown>[];
  readonly threadsRaw?: string;
  readonly threadsError?: Error;
  readonly branch?: string;
  readonly branchError?: Error;
  readonly runs?: {
    UI?: readonly number[];
    API?: readonly number[];
    Architecture?: readonly number[];
  };
  readonly logs?: Record<number, string>;
  readonly logErrors?: Record<number, Error>;
  readonly listRaw?: Record<string, string>;
  readonly listError?: Record<string, Error>;
  readonly commits?: readonly string[];
  readonly commitsError?: Error;
  readonly prViewRaw?: string;
  readonly runHeads?: Record<number, string>;
}

function stub(over: StubOpts = {}): {
  calls: string[][];
  gh: SweepCliIo["gh"];
} {
  const calls: string[][] = [];
  const nodes = over.nodes ?? [
    threadNode(
      "PRRT_api",
      true,
      "github-actions",
      suggestionBody(SUGGESTION_API),
    ),
  ];
  const runs = {
    UI: over.runs?.UI ?? [],
    API: over.runs?.API ?? [111],
    Architecture: over.runs?.Architecture ?? [],
  };
  const logs = over.logs ?? { 111: aiLog(SUGGESTION_API) };
  return {
    calls,
    gh: async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      if (args[0] === "api") {
        if (over.threadsError !== undefined) throw over.threadsError;
        return over.threadsRaw ?? threadPage(nodes);
      }
      if (args[0] === "pr") {
        if (over.branchError !== undefined) throw over.branchError;
        const jsonAt = args.indexOf("--json");
        const fields = jsonAt >= 0 ? String(args[jsonAt + 1] ?? "") : "";
        if (fields.includes("commits")) {
          if (over.commitsError !== undefined) throw over.commitsError;
          if (over.prViewRaw !== undefined) return over.prViewRaw;
          return `${JSON.stringify({
            headRefName: over.branch ?? "feat/example",
            commits: (over.commits ?? [DEFAULT_HEAD]).map((oid) => ({ oid })),
          })}\n`;
        }
        return `${over.branch ?? "feat/example"}\n`;
      }
      if (args[0] === "run" && args[1] === "list") {
        const name = workflowOf(args);
        const listed = over.listError?.[name];
        if (listed !== undefined) throw listed;
        const raw = over.listRaw?.[name];
        if (raw !== undefined) return raw;
        const ids =
          name === WORKFLOW.UI
            ? runs.UI
            : name === WORKFLOW.API
              ? runs.API
              : name === WORKFLOW.Architecture
                ? runs.Architecture
                : [];
        const defaultHead = over.commits?.[0] ?? DEFAULT_HEAD;
        return JSON.stringify(
          ids.map((databaseId) => ({
            databaseId,
            headSha: over.runHeads?.[databaseId] ?? defaultHead,
            event: "pull_request",
          })),
        );
      }
      if (args[0] === "run" && args[1] === "view") {
        const id = Number(args[2]);
        const failed = over.logErrors?.[id];
        if (failed !== undefined) throw failed;
        const log = logs[id];
        if (log === undefined)
          throw new Error(`unexpected run view ${String(id)}`);
        return log;
      }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    },
  };
}

async function runAttribute(
  argv: readonly string[],
  gh: SweepCliIo["gh"],
): Promise<{ code: number; log: string; err: string; ghCalls: number }> {
  let ghCalls = 0;
  const h = harness({
    argv: ["attribute", ...argv],
    readFile: async () => "",
    gh: async (args) => {
      ghCalls += 1;
      return gh(args);
    },
  });
  return {
    code: await runCli(h.io),
    log: h.log.join("\n"),
    err: h.err.join("\n"),
    ghCalls,
  };
}

describe("parseAttributeArgs", () => {
  test("the happy path: the PR whose threads will be attributed", () => {
    expect(parseAttributeArgs(["--pr", "401"])).toEqual({ pr: 401 });
  });

  test("a missing --pr is refused", () => {
    expect(() => parseAttributeArgs([])).toThrow(/--pr is required/);
  });

  test("a non-numeric --pr is refused", () => {
    expect(() => parseAttributeArgs(["--pr", "abc"])).toThrow(/wants a number/);
  });

  test("an option starved of its value is refused, with the attribute usage", () => {
    expect(() => parseAttributeArgs(["--pr"])).toThrow(
      /missing value for --pr/,
    );
    expect(ATTRIBUTE_USAGE).toContain("sweep attribute");
  });

  test("an unknown argument is refused", () => {
    expect(() => parseAttributeArgs(["--pr", "401", "--yolo"])).toThrow(
      /unknown argument '--yolo'/,
    );
  });

  test("usage names the issue_comment coverage limit so /improve threads stay unattributed", () => {
    expect(ATTRIBUTE_USAGE).toMatch(/issue_comment/);
    expect(ATTRIBUTE_USAGE).toMatch(/\/improve/);
    expect(ATTRIBUTE_USAGE).toMatch(/unattributed/);
  });
});

describe("sweep attribute — matching a thread to one workflow", () => {
  test("a thread whose suggestion text appears only in the API run's log is attributed to API", async () => {
    const s = stub();
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_api API resolved");
    expect(log).toContain("API 1 threads 1 resolved");
    expect(log).toContain("UI 0 threads 0 resolved");
    expect(log).toContain("Architecture 0 threads 0 resolved");
    expect(log).toContain("unattributed 0 threads 0 resolved");
  });

  test("text present in no log is unattributed", async () => {
    const s = stub({
      logs: {
        111: aiLog("an unrelated suggestion that lives only in this log"),
      },
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_api unattributed resolved");
    expect(log).not.toContain("PRRT_api API");
    expect(log).toContain("unattributed 1 threads 1 resolved");
    expect(log).toContain("API 0 threads 0 resolved");
  });

  test("text present in two logs is unattributed, never the first match", async () => {
    const s = stub({
      runs: { UI: [10], API: [11], Architecture: [] },
      logs: { 10: aiLog(SUGGESTION_API), 11: aiLog(SUGGESTION_API) },
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_api unattributed resolved");
    expect(log).not.toContain("PRRT_api UI");
    expect(log).not.toContain("PRRT_api API");
    expect(log).toContain("unattributed 1 threads 1 resolved");
    expect(log).toContain("UI 0 threads 0 resolved");
    expect(log).toContain("API 0 threads 0 resolved");
  });

  test("JSON escapes (\\n, \\\", non-breaking hyphen) in the log still match the thread's plain text", async () => {
    const suggestion = `Guard against a missing "cache${NBH}key" header instead of using the non${NBH}null assertion.`;
    const body =
      `**Suggestion:** Guard against a missing "cache${NBH}key" header\n` +
      `instead of using the non${NBH}null assertion. [possible issue, importance: 3]`;
    const logText =
      `\nAI response:\n\`\`\`yaml\ncode_suggestions:\n- suggestion_content: |\n` +
      `    Guard against a missing "cache${NBH}key" header\n` +
      `    instead of using the non${NBH}null assertion.\n`;
    const escaped = `job\tstep\tts ${JSON.stringify({ text: logText }).replaceAll(NBH, "\\u2011")}`;
    const s = stub({
      nodes: [threadNode("PRRT_esc", false, "github-actions", body)],
      logs: { 111: escaped },
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_esc API open");
    expect(log).not.toContain("PRRT_esc unattributed");
    expect(suggestion).toContain('"');
    expect(suggestion).toContain(NBH);
  });

  test("a log whose JSON text contains a literal \\\\n and an escaped quote matches a thread body containing \\n literally", async () => {
    const suggestion = `preserve a literal \\n and a "quoted" token in the suggestion`;
    const s = stub({
      nodes: [
        threadNode(
          "PRRT_bs",
          false,
          "github-actions",
          suggestionBody(suggestion),
        ),
      ],
      logs: { 111: aiLog(suggestion) },
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_bs API open");
    expect(log).not.toContain("PRRT_bs unattributed");
  });

  test("a run whose headSha is not among the PR's commits is ignored: a thread matched only by it is unattributed", async () => {
    const s = stub({
      commits: [DEFAULT_HEAD],
      runs: { UI: [10], API: [11], Architecture: [] },
      runHeads: { 10: "sha-other-pr", 11: DEFAULT_HEAD },
      logs: {
        10: aiLog(SUGGESTION_API),
        11: aiLog("an unrelated suggestion that lives only in this log"),
      },
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_api unattributed resolved");
    expect(log).not.toContain("PRRT_api UI");
    expect(log).not.toContain("PRRT_api API");
    expect(log).toContain("unattributed 1 threads 1 resolved");
    const listCalls = s.calls.filter((c) => c[0] === "run" && c[1] === "list");
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls.every((c) => c.includes("databaseId,headSha,event"))).toBe(
      true,
    );
    const commitView = s.calls.find(
      (c) =>
        c[0] === "pr" &&
        c[1] === "view" &&
        String(c[c.indexOf("--json") + 1] ?? "").includes("commits"),
    );
    expect(commitView).toBeDefined();
  });

  test("a non-github-actions thread (a merge bot, a diff bot) is not listed", async () => {
    const s = stub({
      nodes: [
        threadNode(
          "PRRT_api",
          true,
          "github-actions[bot]",
          suggestionBody(SUGGESTION_API),
        ),
        threadNode(
          "PRRT_diff",
          false,
          "coderabbitai[bot]",
          suggestionBody(SUGGESTION_API),
        ),
        threadNode(
          "PRRT_merge",
          false,
          "qodo-merge",
          suggestionBody(SUGGESTION_API),
        ),
      ],
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_api API resolved");
    expect(log).not.toContain("PRRT_diff");
    expect(log).not.toContain("PRRT_merge");
    expect(log).toContain("API 1 threads 1 resolved");
  });
});

describe("sweep attribute — fail closed", () => {
  test("a failing log read exits 1 with the run id named", async () => {
    const s = stub({
      logErrors: { 111: new Error("gh run view: HTTP 502") },
    });
    const { code, err, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toContain("111");
    expect(err).toMatch(/could not (attribute|be read)|log of run/i);
    expect(log).not.toContain("PRRT_api");
  });

  test("bad arguments exit 2 before any gh call", async () => {
    const s = stub();
    const missing = await runAttribute([], s.gh);
    expect(missing.code).toBe(2);
    expect(missing.ghCalls).toBe(0);
    expect(missing.err).toContain("--pr is required");

    const starved = await runAttribute(["--pr"], s.gh);
    expect(starved.code).toBe(2);
    expect(starved.ghCalls).toBe(0);

    const bad = await runAttribute(["--pr", "nope"], s.gh);
    expect(bad.code).toBe(2);
    expect(bad.ghCalls).toBe(0);

    const unknown = await runAttribute(["--pr", "401", "--yolo"], s.gh);
    expect(unknown.code).toBe(2);
    expect(unknown.ghCalls).toBe(0);
    expect(unknown.err).toContain("unknown argument '--yolo'");
  });

  test("a thread fetch that cannot be read exits 1, naming the failure", async () => {
    const s = stub({ threadsError: new Error("gh api graphql: HTTP 502") });
    const { code, err, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toContain("HTTP 502");
    expect(err).toMatch(/could not attribute/);
    expect(log).not.toContain("PRRT_api");
  });

  test("a PR that is not readable exits 1", async () => {
    const s = stub({
      threadsRaw: JSON.stringify({
        data: { repository: { pullRequest: null } },
      }),
    });
    const { code, err } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toMatch(/not readable/);
  });

  test("a head branch that cannot be read exits 1", async () => {
    const s = stub({ branchError: new Error("gh pr view: HTTP 502") });
    const { code, err } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toContain("HTTP 502");
    expect(err).toMatch(/head branch/);
  });

  test("a head branch that is empty exits 1 rather than listing runs of nothing", async () => {
    const s = stub({ branch: "" });
    const { code, err } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toMatch(/no head branch/);
  });

  test("a run list that cannot be read exits 1, naming the workflow", async () => {
    const s = stub({
      listError: { [WORKFLOW.API]: new Error("gh run list: HTTP 502") },
    });
    const { code, err } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toContain("HTTP 502");
    expect(err).toContain(WORKFLOW.API);
  });

  test("a run list that is not a JSON array exits 1", async () => {
    const s = stub({ listRaw: { [WORKFLOW.UI]: '{"databaseId":1}' } });
    const { code, err } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toMatch(/not a JSON array|could not attribute/);
  });

  test("a run list row with no databaseId exits 1", async () => {
    const s = stub({ listRaw: { [WORKFLOW.UI]: "[{}]" } });
    const { code, err } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toMatch(/databaseId/);
  });

  test("a run list of exactly the limit exits 1, naming the workflow", async () => {
    const ids = Array.from({ length: RUN_LIST_LIMIT }, (_, i) => i + 1);
    const logs: Record<number, string> = { 999: aiLog(SUGGESTION_API) };
    for (const id of ids)
      logs[id] = aiLog("unrelated text that must not become a match");
    const s = stub({
      runs: { UI: ids, API: [999], Architecture: [] },
      logs,
    });
    const { code, err, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toContain(WORKFLOW.UI);
    expect(err).toMatch(/truncated|limit|50/);
    expect(log).not.toContain("PRRT_api");
  });

  test("the PR's commits cannot be read — exit 1, nothing attributed", async () => {
    const s = stub({ commitsError: new Error("gh pr view: HTTP 502") });
    const { code, err, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toContain("HTTP 502");
    expect(err).toMatch(/commit/i);
    expect(log).not.toContain("PRRT_api");
  });

  test.each([
    ["missing", { databaseId: 1, event: "pull_request" }],
    ["empty", { databaseId: 1, headSha: "", event: "pull_request" }],
    ["numeric", { databaseId: 1, headSha: 1, event: "pull_request" }],
  ])(
    "a run list row with %s headSha exits 1, naming the workflow",
    async (_label, row) => {
      const s = stub({
        listRaw: { [WORKFLOW.UI]: JSON.stringify([row]) },
        logs: { 1: aiLog("unrelated"), 111: aiLog(SUGGESTION_API) },
      });
      const { code, err, log } = await runAttribute(["--pr", "401"], s.gh);
      expect(code).toBe(1);
      expect(err).toContain(WORKFLOW.UI);
      expect(err).toMatch(/headSha/);
      expect(log).not.toContain("PRRT_api");
    },
  );

  test.each([
    ["invalid JSON", "nope"],
    ["array", "[]"],
    ["null", "null"],
    ["number", "1"],
    ["missing commits", "{}"],
    ["commits not array", '{"commits":1}'],
    ["empty commits", '{"commits":[]}'],
    ["null row", '{"commits":[null]}'],
    ["scalar row", '{"commits":[1]}'],
    ["array row", '{"commits":[[]]}'],
    ["no oid", '{"commits":[{}]}'],
    ["empty oid", '{"commits":[{"oid":""}]}'],
    ["numeric oid", '{"commits":[{"oid":1}]}'],
  ])("commits payload %s exits 1", async (_label, raw) => {
    const s = stub({ prViewRaw: raw });
    const { code, err, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(1);
    expect(err).toMatch(/commit/i);
    expect(log).not.toContain("PRRT_api");
  });
});

describe("decodeRunLog", () => {
  test("a quoted JSON string is parsed, so \\\\n is a literal backslash-n", () => {
    expect(decodeRunLog('"keep \\\\n and \\"q\\""')).toBe('keep \\n and "q"');
  });

  test("an unquoted \\\\n is a literal backslash-n, not a newline", () => {
    expect(decodeRunLog("\\\\n")).toBe("\\n");
  });

  test("unquoted escapes still decode (a log line with no JSON object)", () => {
    expect(decodeRunLog('\\"cache\\u2011key\\"')).toBe(`"cache${NBH}key"`);
    expect(decodeRunLog("line\\nbreak")).toBe("line\nbreak");
  });

  test("a quoted region that is not valid JSON is left in place", () => {
    expect(decodeRunLog('"\\x" leftover')).toBe('"\\x" leftover');
    expect(decodeRunLog('"unterminated')).toBe('"unterminated');
    expect(decodeRunLog('"trailing\\')).toBe('"trailing\\');
  });

  test("unknown or truncated escapes are left in place", () => {
    expect(decodeRunLog("\\x")).toBe("\\x");
    expect(decodeRunLog("trailing\\")).toBe("trailing\\");
    expect(decodeRunLog("\\uZZZZ")).toBe("\\uZZZZ");
    expect(decodeRunLog("\\u12")).toBe("\\u12");
  });
});

describe("sweep attribute — bodies that cannot be matched", () => {
  test("a github-actions thread with no Suggestion marker is unattributed", async () => {
    const s = stub({
      nodes: [
        threadNode("PRRT_plain", false, "github-actions", "just a comment"),
      ],
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_plain unattributed open");
  });

  test("a Suggestion followed by a fenced code block still matches the log", async () => {
    const body =
      `**Suggestion:** ${SUGGESTION_API} [possible issue, importance: 2]\n` +
      "```suggestion\n  const decode = async () => {};\n```";
    const s = stub({
      nodes: [threadNode("PRRT_fence", true, "github-actions", body)],
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_fence API resolved");
    expect(log).not.toContain("PRRT_fence unattributed");
  });

  test("a Suggestion with no trailing [label, importance: n] is unattributed", async () => {
    const s = stub({
      nodes: [
        threadNode(
          "PRRT_trail",
          false,
          "github-actions",
          `**Suggestion:** ${SUGGESTION_API}`,
        ),
      ],
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_trail unattributed open");
  });

  test("a Suggestion whose content is blank is unattributed", async () => {
    const s = stub({
      nodes: [
        threadNode(
          "PRRT_blank",
          true,
          "github-actions",
          "**Suggestion:**   [critical bug, importance: 4]",
        ),
      ],
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_blank unattributed resolved");
  });

  test("a log line with no JSON object still decodes escapes, so a quoted suggestion matches", async () => {
    const suggestion = `Guard against a missing "cache${NBH}key" header.`;
    const raw = `plain prefix suggestion_content: |\\n    Guard against a missing \\"cache\\u2011key\\" header.\\n`;
    const s = stub({
      nodes: [
        threadNode(
          "PRRT_raw",
          false,
          "github-actions",
          suggestionBody(suggestion, "possible issue", 3),
        ),
      ],
      logs: { 111: raw },
    });
    const { code, log } = await runAttribute(["--pr", "401"], s.gh);
    expect(code).toBe(0);
    expect(log).toContain("PRRT_raw API open");
  });
});
