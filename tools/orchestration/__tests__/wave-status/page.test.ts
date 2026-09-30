import { afterEach, describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import {
  BUILTIN_TOKENS_CSS,
  extractDarkBlock,
  extractRootBlock,
  startServer,
} from "../../src/wave-status/server.js";
import {
  collect,
  realDepsFor,
  type CollectDeps,
} from "../../src/wave-status/lib/collect.js";
import {
  laneState,
  laneStateCounts,
  laneNeedsHuman,
  stallThresholdMs,
  pastWaveThresholdMs,
  LANE_STATES,
} from "../../src/wave-status/lib/lane-state.js";
import { readEvents } from "../../src/internal/events.js";
import { emptyConfig, type Config } from "../../src/internal/config.js";
import type {
  DerivedLane,
  LaneStatus,
  WaveStatus,
} from "../../src/internal/wave-types.js";

const PAGE_PATH = fileURLToPath(
  new URL("../../public/wave-status/index.html", import.meta.url),
);

/**
 * The tokens the server serves when the project set no `tokensCssPath`: this
 * package's own neutral set. The source read one application's real
 * tokens.css — that file belongs to that application, and this package is
 * published, so its page is checked against a palette this package ships.
 */
const builtinTokensCss = (): string =>
  `${extractRootBlock(BUILTIN_TOKENS_CSS) ?? ""}\n\n${extractDarkBlock(BUILTIN_TOKENS_CSS) ?? ""}\n`;

/** The event writer, as the built bin — the one thing that fills an events.jsonl. */
const WAVE_EVENT_BIN = resolve(
  import.meta.dirname,
  "../../dist/bins/wave-event.js",
);

const REPO = "acme/demo";
const REPO_ROOT = "/repo";

/** The overlay the page's server face runs with. */
function config(overrides: Partial<Config> = {}): Config {
  return { ...emptyConfig(), repo: REPO, ...overrides };
}

/** The process-facing deps, with the overlay's settings filled in. */
function fixtureDeps(overrides: Partial<CollectDeps> = {}): CollectDeps {
  return {
    ...realDepsFor(REPO_ROOT),
    repo: REPO,
    planningDir: "/repo/docs/planning",
    pgrep: async () => 0,
    gh: async () => "[]",
    git: async () => "",
    ...overrides,
  };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readonly url: string;
  closed = false;

  readonly listeners: Record<string, ((event: { data: string }) => void)[]> =
    {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: { data: string }) => void,
  ): void {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data });
    }
  }

  close(): void {
    this.closed = true;
  }
}

interface PageHandle {
  readonly window: Window;
  readonly fetches: string[];
  // Every interval the page registered, keyed by its own id and carrying its
  // period: the page keeps more than one timer (the poll fallback and the age
  // tick), so a test must say which one it wants to fire.
  readonly intervals: ReadonlyMap<
    number,
    { readonly ms: number; readonly handler: () => void }
  >;
  readonly source: FakeEventSource;
  // Invokes the most recently registered setInterval handler with that period,
  // as if a real tick had fired — the harness never runs timers itself. A
  // period with no registered timer throws rather than doing nothing.
  readonly fireInterval: (ms: number) => void;
  readonly firePoll: () => void;
}

const windows: Window[] = [];
const dirs: string[] = [];

// The page's SSE-fallback poll period. Named here because the harness fires
// timers by period, and a test that says "a tick fired" must say which one.
const POLL_INTERVAL_MS = 10_000;

afterEach(() => {
  vi.useRealTimers();
  FakeEventSource.instances = [];
  while (windows.length > 0) {
    windows.pop()?.happyDOM.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Run the BUILT event writer against a temp log root. The source drove a shell
 * script by path; this is the same contract behind the bin this package ships,
 * and driving the artifact is what proves the contract still holds end to end.
 */
function emit(
  project: string,
  wave: string,
  lane: string,
  stage: string,
  event: string,
  flags: Record<string, string> = {},
): void {
  const args = [WAVE_EVENT_BIN, wave, lane, stage, event];
  for (const [flag, value] of Object.entries(flags))
    args.push(`--${flag}`, value);
  execFileSync(process.execPath, args, {
    // A temporary project, so the writer resolves ITS overlay rather than
    // whatever project this suite happens to be run from.
    cwd: project,
    env: {
      ...process.env,
      WAVE_LOG_ROOT: project,
      LOGDIR: "",
    },
  });
}

const statusAt = (detail?: Record<string, unknown>): WaveStatus =>
  ({
    generatedAt: "now",
    waves: [
      {
        id: "T",
        lanes: [
          {
            wave: "T",
            lane: "t1",
            reported:
              detail === undefined
                ? undefined
                : {
                    stage: "remediate",
                    event: "settled",
                    ts: "now",
                    detail,
                  },
            derived: { alive: false },
            disagreements: [],
          },
        ],
      },
    ],
  }) as WaveStatus;

// Two waves, five lanes: alive and not, and the three reported outcomes, plus
// one lane with no events at all. Four observed PRs — one lane has none — two
// open, two merged, one with failing checks.
const mixedStatus: WaveStatus = {
  generatedAt: "now",
  waves: [
    {
      id: "T",
      lanes: [
        {
          wave: "T",
          lane: "t1",
          reported: { stage: "remediate", event: "settled", ts: "now" },
          derived: {
            alive: true,
            pr: {
              number: 1,
              state: "open",
              checks: "pass",
              unresolvedThreads: 0,
            },
          },
          disagreements: [],
        },
        {
          wave: "T",
          lane: "t2",
          reported: { stage: "gate", event: "failed", ts: "now" },
          derived: {
            alive: false,
            pr: { number: 2, state: "open", checks: "fail" },
          },
          disagreements: [],
        },
        {
          wave: "T",
          lane: "t3",
          reported: { stage: "review", event: "started", ts: "now" },
          derived: { alive: true },
          disagreements: [],
        },
        {
          wave: "T",
          lane: "t4",
          derived: {
            alive: false,
            pr: { number: 3, state: "merged", checks: "none" },
          },
          disagreements: [],
        },
      ],
    },
    {
      id: "U",
      lanes: [
        {
          wave: "U",
          lane: "u1",
          reported: { stage: "merge", event: "settled", ts: "now" },
          derived: {
            alive: false,
            pr: { number: 4, state: "merged", checks: "pass" },
          },
          disagreements: [],
        },
      ],
    },
  ],
} as WaveStatus;

// One lane in every state `laneState` can name, built around `now` so the two
// lanes that straddle the stall threshold stay on their own side of it while the
// page and the lib function each read their own clock: the stalled one is a
// minute past the threshold, the long-running one five minutes short of it. If
// either implementation's threshold moves — the page's literal or the exported
// constant — one of these two lanes starts disagreeing with the other, which is
// what the parity test below is for.
const stateFixture = (now: number): WaveStatus => {
  const logQuietFor = (ms: number) => ({
    bytes: 128,
    mtimeMs: now - ms,
    tail: "",
  });
  const lane = (
    id: string,
    derived: Record<string, unknown>,
    disagreements: string[] = [],
  ): Record<string, unknown> => ({
    wave: "S",
    lane: id,
    derived,
    disagreements,
  });
  return {
    generatedAt: new Date(now).toISOString(),
    waves: [
      {
        id: "S",
        lanes: [
          lane("conflict", { alive: true, exit: 1 }, [
            "reported settled, EXIT is 1",
          ]),
          lane("failed", { alive: false, exit: 1 }),
          lane("stalled", {
            alive: true,
            log: logQuietFor(stallThresholdMs + 60_000),
          }),
          lane("running", { alive: true, log: logQuietFor(4 * 60_000) }),
          lane("patient", {
            alive: true,
            log: logQuietFor(stallThresholdMs - 5 * 60_000),
          }),
          lane("no-log", { alive: true }),
          lane("vanished", { alive: false, exit: 0 }),
          lane("blocked", {
            alive: false,
            pr: { number: 5, state: "open", checks: "pending" },
          }),
          lane("unstarted", {
            alive: false,
            pr: { number: 11, state: "open", checks: "none" },
          }),
          lane("ready", {
            alive: false,
            pr: {
              number: 6,
              state: "open",
              checks: "pass",
              unresolvedThreads: 0,
            },
          }),
          lane("merged", {
            alive: false,
            pr: { number: 7, state: "merged", checks: "pass" },
          }),
          // The two facts the page puts on screen, and the gap between them:
          // a measured unresolved thread under green CI blocks; a read that
          // could not be taken names itself as unknown — never blocked,
          // because blocked asserts something is in the way.
          lane("review-blocked", {
            alive: false,
            pr: {
              number: 8,
              state: "open",
              checks: "pass",
              unresolvedThreads: 2,
            },
          }),
          lane("unasked", {
            alive: false,
            pr: {
              number: 9,
              state: "open",
              checks: "unknown",
              unresolvedThreads: 0,
            },
          }),
          lane("threads-unread", {
            alive: false,
            pr: {
              number: 10,
              state: "open",
              checks: "pass",
              unresolvedThreads: "unknown",
            },
          }),
          // A past wave keeps its row's own verdict — the state word is
          // unchanged — but stops counting toward "needs a human", UNLESS a
          // fresh, live-probed fact (alive, a currently-failing open PR, or a
          // currently-counted unresolved thread) says otherwise: those are
          // re-read every collection and can be fresher than the lane's own
          // dated evidence. "past-failed" has none of the three and stays
          // suppressed even past a merged PR; the other three each carry
          // exactly one and are rescued despite evidence a day stale.
          lane("past-failed", {
            alive: false,
            exit: 1,
            log: logQuietFor(pastWaveThresholdMs + 60_000),
            pr: { number: 12, state: "merged", checks: "pass" },
          }),
          lane("past-alive", {
            alive: true,
            log: logQuietFor(pastWaveThresholdMs + 60_000),
          }),
          lane("past-pr-failing", {
            alive: false,
            log: logQuietFor(pastWaveThresholdMs + 60_000),
            pr: { number: 13, state: "open", checks: "fail" },
          }),
          lane("past-pr-blocked", {
            alive: false,
            log: logQuietFor(pastWaveThresholdMs + 60_000),
            pr: {
              number: 14,
              state: "open",
              checks: "pass",
              unresolvedThreads: 2,
            },
          }),
        ],
      },
    ],
  } as unknown as WaveStatus;
};

// The state word each lane's leading cell must carry, and the tone it is
// painted in. Eight states share the page's five existing tones — conflict and
// failed are both red, stalled and blocked both amber — because the word is
// what names the state (WCAG 1.4.1); the tone only ranks it. The tones are the
// ones already in the stylesheet, so no new colour enters the palette.
const EXPECTED_STATE_PILLS: ReadonlyArray<readonly [string, string, string]> = [
  ["conflict", "conflict", "bad"],
  ["failed", "failed", "bad"],
  ["stalled", "stalled", "warn"],
  ["running", "running", "info"],
  ["patient", "running", "info"],
  ["no-log", "running", "info"],
  ["vanished", "vanished", "bad"],
  ["blocked", "blocked", "warn"],
  ["unstarted", "blocked", "warn"],
  ["ready", "ready", "ok"],
  ["merged", "merged", "dim"],
  ["review-blocked", "blocked", "warn"],
  ["unasked", "unknown", "dim"],
  ["threads-unread", "unknown", "dim"],
  // Past-wave lanes still lead with their earned state word — only the
  // needs-a-human count and the hide-inactive set change underneath them.
  ["past-failed", "failed", "bad"],
  ["past-alive", "stalled", "warn"],
  ["past-pr-failing", "failed", "bad"],
  ["past-pr-blocked", "blocked", "warn"],
];

// name, label, value — counts for mixedStatus above.
const EXPECTED_METRICS: ReadonlyArray<readonly [string, string, string]> = [
  ["lanes", "lanes", "5"],
  ["alive", "alive", "2"],
  ["settled", "settled", "2"],
  ["failed", "failed", "1"],
  ["running", "running", "1"],
  ["open", "PRs open", "2"],
  ["merged", "PRs merged", "2"],
  ["failing", "checks failing", "1"],
  ["waves", "waves", "2"],
];

const pageStyle = async (): Promise<string> => {
  const html = await readFile(PAGE_PATH, "utf8");
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
};

const scanReferencedTokens = (html: string): Set<string> => {
  const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!styleMatch || !styleMatch[1]) {
    throw new Error("page has no <style> block or it is empty");
  }
  const referencedTokens = new Set<string>();
  for (const match of styleMatch[1].matchAll(
    /var\(\s*(--[a-z0-9-]+)\s*(?:,|\))/gi,
  )) {
    referencedTokens.add(match[1]);
  }
  return referencedTokens;
};

type LogPayload =
  | string
  | Uint8Array
  | ((url: string) => Promise<Response> | Response);

interface LoadPageOptions {
  width?: number;
  storage?: Record<string, string>;
  mockStorageError?: boolean;
  // Lets a test flip /api/status from healthy to unreachable after the
  // page's own initial load (which must succeed, or loadPage's own
  // waitFor below never resolves) — the object is held by reference, so
  // the test can mutate `.ok` after loadPage returns.
  statusGate?: { ok: boolean };
  // Lets a test take full control of what each /api/status call receives,
  // by call index (1-based) — the first call still has to feed loadPage's
  // own waitFor below (a Promise that never resolves would hang the load),
  // so a responder that wants to race a later poll should resolve call 1
  // immediately and only defer from call 2 on.
  statusResponder?: (callIndex: number) => Promise<Response> | Response;
  tokensCss?: string | false;
}

async function loadPage(
  status: WaveStatus,
  logText: LogPayload = "log-tail",
  options?: LoadPageOptions,
): Promise<PageHandle> {
  const html = await readFile(PAGE_PATH, "utf8");
  const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (scriptMatch === null) throw new Error("page has no script");

  const window = new Window({
    url: "http://127.0.0.1/",
    width: options?.width,
  });
  windows.push(window);

  if (options?.storage) {
    for (const [key, value] of Object.entries(options.storage)) {
      window.localStorage.setItem(key, value);
    }
  }
  if (options?.mockStorageError) {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("localStorage read failed");
    });
  }

  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ""));

  const tokensCss =
    options?.tokensCss !== undefined
      ? options.tokensCss
      : await (async () => {
          return builtinTokensCss();
        })();

  if (tokensCss) {
    const style = window.document.createElement("style");
    style.setAttribute("data-tokens", "");
    style.textContent = tokensCss;
    window.document.head.appendChild(style);
  }

  const fetches: string[] = [];
  let statusCalls = 0;
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    fetches.push(url);
    if (url.startsWith("/api/status")) {
      statusCalls++;
      if (options?.statusResponder) {
        return options.statusResponder(statusCalls);
      }
      // The very first call feeds loadPage's own waitFor below — it must
      // succeed regardless of the gate, or the page never finishes loading.
      if (options?.statusGate && statusCalls > 1 && !options.statusGate.ok) {
        throw new Error("status fetch failed");
      }
      return new Response(JSON.stringify(status), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith("/api/log/")) {
      if (typeof logText === "function") {
        const res = await logText(url);
        return res instanceof Response
          ? res
          : new Response(res, {
              status: 200,
              headers: { "content-type": "text/plain" },
            });
      }
      return new Response(logText as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const intervals = new Map<number, { ms: number; handler: () => void }>();
  let nextId = 1;
  const setIntervalImpl = (handler: () => void, ms?: number): number => {
    intervals.set(nextId, { ms: ms ?? 0, handler });
    return nextId++;
  };
  const clearIntervalImpl = (id: number): void => {
    intervals.delete(id);
  };
  // Loud, never a silent no-op: a test that believes it fired a tick must not
  // pass because the page stopped registering that timer.
  const fireInterval = (ms: number): void => {
    let latest: { ms: number; handler: () => void } | undefined;
    for (const timer of intervals.values()) {
      if (timer.ms === ms) latest = timer;
    }
    if (latest === undefined) {
      throw new Error(`no interval registered with period ${ms} ms`);
    }
    latest.handler();
  };
  const firePoll = (): void => fireInterval(POLL_INTERVAL_MS);

  const run = new Function(
    "document",
    "fetch",
    "EventSource",
    "setInterval",
    "clearInterval",
    "window",
    "getComputedStyle",
    scriptMatch[1],
  ) as (
    document: Document,
    fetch: typeof globalThis.fetch,
    EventSource: typeof FakeEventSource,
    setIntervalFn: (handler: () => void, ms?: number) => number,
    clearIntervalFn: (id: number) => void,
    window: Window,
    getComputedStyle: typeof window.getComputedStyle,
  ) => void;

  run(
    window.document as unknown as Document,
    fetchImpl,
    FakeEventSource,
    setIntervalImpl,
    clearIntervalImpl,
    window,
    window.getComputedStyle.bind(window),
  );

  await vi.waitFor(() => {
    expect(window.document.querySelector("tr.lane")).not.toBeNull();
  });

  const source = FakeEventSource.instances[0];
  if (source === undefined) throw new Error("EventSource was not constructed");

  return { window, fetches, intervals, source, fireInterval, firePoll };
}

// happy-dom implements no activation behaviour for <button>: a real browser
// fires a click when Enter or Space is pressed on a focused button, but the
// test DOM does not, so simulate what the browser would do rather than add
// that translation to the page itself (the page relies on the real thing).
// Untyped, like the rest of this file's `as unknown as HTMLElement` casts:
// happy-dom's own DOM types are not structurally assignable to lib.dom's —
// this only ever runs against elements returned from `page.window.document`.
function press(target: unknown, key: string): void {
  const el = target as unknown as {
    ownerDocument: { defaultView: unknown } | null;
    dispatchEvent(event: unknown): boolean;
    click(): void;
  };
  const event = new (
    el.ownerDocument!.defaultView as unknown as {
      KeyboardEvent: typeof KeyboardEvent;
    }
  ).KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (el.dispatchEvent(event)) {
    el.click();
  }
}

describe("the status page", () => {
  test("Enter or Space on a lane row's button fetches the log", async () => {
    const page = await loadPage(statusAt());
    const row = page.window.document.querySelector("tr.lane");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("role")).not.toBe("button");
    const button = row?.querySelector("button") ?? null;
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.textContent?.trim().length).toBeGreaterThan(0);

    const logUrl = "/api/log/T/t1?tail=16";
    press(button!, "Enter");
    const logView = page.window.document.getElementById(
      "log",
    ) as HTMLElement | null;
    await vi.waitFor(() => {
      expect(page.fetches).toContain(logUrl);
      expect(logView?.hidden).toBe(false);
      expect(logView?.textContent).toContain("log-tail");
    });
    // A deleted hand-rolled keydown handler and native <button> activation
    // both answering the same key press is exactly the double-fire a real
    // browser would never produce: one key press, one fetch.
    expect(page.fetches.filter((url) => url === logUrl)).toHaveLength(1);

    page.fetches.length = 0;
    if (logView !== null) logView.textContent = "";
    press(button!, " ");
    await vi.waitFor(() => {
      expect(page.fetches).toContain(logUrl);
      expect(logView?.textContent).toContain("log-tail");
    });
    expect(page.fetches.filter((url) => url === logUrl)).toHaveLength(1);
  });

  test("a click anywhere on a lane row still opens the log", async () => {
    const page = await loadPage(statusAt());
    const row = page.window.document.querySelector(
      "tr.lane",
    ) as unknown as HTMLElement | null;
    expect(row).not.toBeNull();
    row?.click();
    await vi.waitFor(() => {
      expect(page.fetches).toContain("/api/log/T/t1?tail=16");
    });
  });

  test("every wave and lane button carries a non-empty accessible name", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveButtons = doc.querySelectorAll("tr.wave button");
    const laneButtons = doc.querySelectorAll("tr.lane button");
    expect(waveButtons.length).toBe(2);
    expect(laneButtons.length).toBe(5);
    for (const button of [...waveButtons, ...laneButtons]) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  test('no <tr> carries role="button", and the page never wires its own keydown handling for it', async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    for (const row of doc.querySelectorAll("tr")) {
      expect(row.getAttribute("role")).not.toBe("button");
    }
    const html = await readFile(PAGE_PATH, "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).not.toMatch(/addEventListener\(\s*["']keydown["']/);
  });

  test("a second SSE drop does not stack polling intervals", async () => {
    const page = await loadPage(statusAt());
    page.source.onerror?.();
    page.source.onerror?.();
    // Counted by period, not by total: the page also keeps its own age tick,
    // which is registered once at load and is not this test's subject.
    const polls = [...page.intervals.values()].filter(
      (timer) => timer.ms === POLL_INTERVAL_MS,
    );
    expect(polls).toHaveLength(1);
  });

  test("a detail value of <b> renders as text, not markup", async () => {
    const page = await loadPage(
      statusAt({
        fixed: "<b>",
        refuted: "<img>",
        mutations: "</td>",
        mutationsBit: "<i>",
      }),
    );
    const cell = page.window.document.querySelector("tr.lane td:last-child");
    expect(cell?.textContent).toContain("<b>");
    expect(cell?.textContent).toContain("<img>");
    expect(cell?.textContent).toContain("</td>");
    expect(cell?.textContent).toContain("<i>");
    expect(cell?.innerHTML).toContain("&lt;b&gt;");
    expect(cell?.innerHTML).toContain("&lt;img&gt;");
    expect(cell?.innerHTML).toContain("&lt;/td&gt;");
    expect(cell?.innerHTML).toContain("&lt;i&gt;");
    expect(cell?.querySelector("b")).toBeNull();
    expect(cell?.querySelector("img")).toBeNull();
    expect(cell?.querySelector("i")).toBeNull();
  });

  test("the metrics strip renders each metric with its label", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    for (const [name, label, value] of EXPECTED_METRICS) {
      const metric = doc.querySelector(`[data-metric="${name}"]`);
      expect(metric?.querySelector(".value")?.textContent).toBe(value);
      expect(metric?.querySelector(".label")?.textContent).toBe(label);
    }
    // PR metrics come from observed PRs, not from lanes: five lanes (one with
    // no PR at all) yield PRs open 2 — a count fed by lanes instead of PR
    // observations would read 5, or sweep the no-PR lane into some bucket.
    expect(doc.querySelector('[data-metric="open"] .value')?.textContent).toBe(
      "2",
    );
    expect(
      doc.querySelector('[data-metric="merged"] .value')?.textContent,
    ).toBe("2");
    expect(doc.querySelector('[data-metric="lanes"] .value')?.textContent).toBe(
      "5",
    );
    // A problem count only turns red when there is a problem — mixedStatus
    // has one failed lane and one failing check, so those two values (and
    // only those two) carry the hot class.
    expect(
      doc
        .querySelector('[data-metric="failed"] .value')
        ?.classList.contains("hot"),
    ).toBe(true);
    expect(
      doc
        .querySelector('[data-metric="failing"] .value')
        ?.classList.contains("hot"),
    ).toBe(true);
    expect(
      doc
        .querySelector('[data-metric="settled"] .value')
        ?.classList.contains("hot"),
    ).toBe(false);
  });

  test("an unknown metric renders —, never 0", async () => {
    // statusAt(): one lane, no reported events, no PR — nothing is known
    // about outcomes or PRs, and the header must say so.
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    for (const name of [
      "settled",
      "failed",
      "running",
      "open",
      "merged",
      "failing",
    ]) {
      expect(
        doc.querySelector(`[data-metric="${name}"] .value`)?.textContent,
      ).toBe("—");
    }
    // The structural counts are known the moment a status arrives; a known
    // zero (all lanes not alive) is a real answer, unlike an unknown one.
    expect(doc.querySelector('[data-metric="lanes"] .value')?.textContent).toBe(
      "1",
    );
    expect(doc.querySelector('[data-metric="alive"] .value')?.textContent).toBe(
      "0",
    );
    expect(doc.querySelector('[data-metric="waves"] .value')?.textContent).toBe(
      "1",
    );
  });

  test("an unknown check count on an open PR renders —, but a measured zero renders 0", async () => {
    const withUnknownChecks: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: {
                alive: false,
                pr: { number: 1, state: "open", checks: "unknown" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;
    const pageUnknown = await loadPage(withUnknownChecks);
    expect(
      pageUnknown.window.document.querySelector(
        '[data-metric="failing"] .value',
      )?.textContent,
    ).toBe("—");

    const withMeasuredZero: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: {
                alive: false,
                pr: { number: 1, state: "open", checks: "pass" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;
    const pageZero = await loadPage(withMeasuredZero);
    expect(
      pageZero.window.document.querySelector('[data-metric="failing"] .value')
        ?.textContent,
    ).toBe("0");
  });

  test("the container declares two grid rows and the log pane is hidden with no log open", async () => {
    const page = await loadPage(statusAt());
    const html = await readFile(PAGE_PATH, "utf8");
    const style = await pageStyle();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    // Two rows with no log open, three with one — the grid sizes both panes;
    // JavaScript only flips the state, it must never listen for resizes.
    expect(style).toMatch(/#page\s*\{[^}]*grid-template-rows:\s*auto 1fr\s*;/);
    expect(style).toMatch(
      /#page\.with-log\s*\{[^}]*grid-template-rows:\s*auto 1fr 1fr\s*;/,
    );
    expect(style).not.toMatch(/max-height:\s*40vh/);
    expect(script).not.toMatch(
      /addEventListener\(\s*["']resize["']|onresize\s*=/,
    );
    const logView = page.window.document.getElementById(
      "log",
    ) as HTMLElement | null;
    expect(logView?.hidden).toBe(true);
  });

  test("opening a log reveals the second row; closing it returns the table to full height", async () => {
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    const container = doc.getElementById("page");
    const logPane = doc.getElementById("log-pane") as HTMLElement | null;
    const logView = doc.getElementById("log") as HTMLElement | null;
    expect(container?.classList.contains("with-log")).toBe(false);
    expect(logPane?.hidden).toBe(true);
    expect(logView?.hidden).toBe(true);

    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(page.fetches).toContain("/api/log/T/t1?tail=16");
      expect(logPane?.hidden).toBe(false);
      expect(logView?.hidden).toBe(false);
      expect(container?.classList.contains("with-log")).toBe(true);
    });

    const closeBtn = doc.querySelector(
      'button[aria-label="close"]',
    ) as unknown as HTMLElement | null;
    closeBtn?.click();
    expect(logPane?.hidden).toBe(true);
    expect(logView?.hidden).toBe(true);
    expect(container?.classList.contains("with-log")).toBe(false);
  });

  test("the pane shows a visible focus treatment when focused", async () => {
    const page = await loadPage(statusAt(), "log-tail");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    const logPane = doc.getElementById("log-pane");

    expect(doc.activeElement).not.toBe(logPane);
    expect(page.window.getComputedStyle(logPane!).outlineStyle).not.toBe(
      "solid",
    );

    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(doc.activeElement).toBe(logPane);
    });

    const style = page.window.getComputedStyle(logPane!);
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
  });

  test("the toolbar renders each control with an accessible name, and the lane name and byte size", async () => {
    const page = await loadPage(statusAt(), "log-tail");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    // The pane itself is revealed synchronously, before the log tail fetch
    // resolves (the active lane's identity settles before the request
    // starts) — wait for the fetched size instead, which only appears once
    // the response has landed.
    await vi.waitFor(() => {
      expect(doc.getElementById("log-size")?.textContent?.trim()).toBe("8 B");
    });

    const toolbar = doc.getElementById("log-toolbar");
    expect(toolbar).not.toBeNull();
    expect(doc.getElementById("log-lane")?.textContent?.trim()).toBe("T/t1");

    const expandBtn = toolbar?.querySelector('button[aria-label="expand"]');
    const copyBtn = toolbar?.querySelector('button[aria-label="copy"]');
    const downloadBtn = toolbar?.querySelector('button[aria-label="download"]');
    const closeBtn = toolbar?.querySelector('button[aria-label="close"]');

    expect(expandBtn).not.toBeNull();
    expect(expandBtn?.textContent?.trim()).toBe("expand");
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.textContent?.trim()).toBe("copy");
    expect(downloadBtn).not.toBeNull();
    expect(downloadBtn?.textContent?.trim()).toBe("download");
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.textContent?.trim()).toBe("close");
  });

  test("expand sets the table row to zero and collapse restores it; the toggle's label changes", async () => {
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    const container = doc.getElementById("page");
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(container?.classList.contains("with-log")).toBe(true);
    });

    const expandBtn = doc.querySelector(
      'button[aria-label="expand"]',
    ) as unknown as HTMLElement;
    expect(expandBtn.textContent?.trim()).toBe("expand");
    expect(page.window.getComputedStyle(container!).gridTemplateRows).toBe(
      "auto 1fr 1fr",
    );

    expandBtn.click();
    expect(container?.classList.contains("expanded")).toBe(true);
    expect(expandBtn.textContent?.trim()).toBe("collapse");
    expect(expandBtn.getAttribute("aria-label")).toBe("collapse");
    expect(page.window.getComputedStyle(container!).gridTemplateRows).toBe(
      "auto 0 1fr",
    );

    expandBtn.click();
    expect(container?.classList.contains("expanded")).toBe(false);
    expect(expandBtn.textContent?.trim()).toBe("expand");
    expect(expandBtn.getAttribute("aria-label")).toBe("expand");
    expect(page.window.getComputedStyle(container!).gridTemplateRows).toBe(
      "auto 1fr 1fr",
    );
  });

  test("the expand icon reflects aria-expanded in both states", async () => {
    // getComputedStyle resolves class-driven and attribute-driven declarations
    // in this suite because the page includes its
    // <style> block — assert the computed transform rotates when expanded.
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
    });

    const expandBtn = doc.querySelector(
      'button[aria-label="expand"]',
    ) as unknown as HTMLElement;
    const icon = doc.querySelector("#log-expand svg");

    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
    expect(expandBtn.getAttribute("aria-controls")).toBe("log-pane");
    expect(page.window.getComputedStyle(icon!).transform).not.toBe(
      "rotate(180deg)",
    );

    expandBtn.click();
    expect(expandBtn.getAttribute("aria-expanded")).toBe("true");
    expect(expandBtn.getAttribute("aria-label")).toBe("collapse");
    expect(page.window.getComputedStyle(icon!).transform).toBe(
      "rotate(180deg)",
    );

    expandBtn.click();
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
    expect(expandBtn.getAttribute("aria-label")).toBe("expand");
    expect(page.window.getComputedStyle(icon!).transform).not.toBe(
      "rotate(180deg)",
    );
  });

  test("copy writes the body text without line numbers — assert the clipboard payload", async () => {
    const multiline = "first line\nsecond line\nthird line";
    const page = await loadPage(statusAt(), multiline);
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    // Wait for the body itself, not just the pane's visibility — the pane
    // is revealed before the log tail fetch resolves.
    await vi.waitFor(() => {
      expect(doc.querySelectorAll(".line").length).toBeGreaterThan(0);
    });

    const copyBtn = doc.querySelector(
      'button[aria-label="copy"]',
    ) as unknown as HTMLElement;
    copyBtn.click();
    await vi.waitFor(async () => {
      const text = await page.window.navigator.clipboard.readText();
      expect(text).toBe(multiline);
    });
  });

  test("the copy feedback states render and clear", async () => {
    const page = await loadPage(statusAt(), "one line");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(doc.querySelectorAll(".line").length).toBeGreaterThan(0);
    });

    const copyBtn = doc.querySelector(
      'button[aria-label="copy"]',
    ) as unknown as HTMLElement;

    vi.useFakeTimers();
    try {
      copyBtn.click();
      await vi.waitFor(() => {
        expect(copyBtn.textContent?.trim()).toBe("copied");
      });
      expect(copyBtn.classList.contains("ok")).toBe(true);
      expect(copyBtn.classList.contains("bad")).toBe(false);

      vi.advanceTimersByTime(1600);
      expect(copyBtn.textContent?.trim()).toBe("copy");
      expect(copyBtn.classList.contains("ok")).toBe(false);
      expect(copyBtn.classList.contains("bad")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the gutter is user-select: none, and the number of gutter entries equals the line count", async () => {
    const multiline = "alpha\nbeta\ngamma\ndelta";
    const lineCount = 4;
    const page = await loadPage(statusAt(), multiline);
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    // Wait for the fetched body, not just the pane's visibility — the pane
    // is revealed before the log tail fetch resolves.
    await vi.waitFor(() => {
      expect(doc.querySelectorAll(".gutter").length).toBe(lineCount);
    });

    const gutters = doc.querySelectorAll(".gutter");
    expect(gutters.length).toBe(lineCount);
    for (const gutter of gutters) {
      expect(page.window.getComputedStyle(gutter).userSelect).toBe("none");
    }
  });

  test("the page still declares no --color-* custom property of its own", async () => {
    const style = await pageStyle();
    expect(style).toMatch(/var\(--color-/); // tokens are consumed, from /tokens.css
    expect(style).not.toMatch(/--color-[\w-]+\s*:/);
  });

  test("the connection indicator reflects each state it can be in, driven by the real connection", async () => {
    const statusGate = { ok: true };
    const page = await loadPage(statusAt(), undefined, { statusGate });
    const doc = page.window.document;
    const indicator = doc.getElementById("connection") as HTMLElement | null;
    expect(indicator).not.toBeNull();

    // Before any SSE event fires, the page is still connecting — nothing
    // has pinned it to a class of its own; this is the markup's own initial
    // state, still standing.
    expect(indicator?.className).toBe("connecting");
    expect(indicator?.textContent).toMatch(/connecting/);

    // The stream opens: live.
    page.source.onopen?.();
    expect(indicator?.className).toBe("live");
    expect(indicator?.textContent).toMatch(/live/);

    // An SSE status event also (re-)confirms live.
    page.source.emit("status", JSON.stringify(statusAt()));
    expect(indicator?.className).toBe("live");

    // The stream drops but the status endpoint still answers: polling, not
    // down — connectivity to the server itself is still fine.
    page.source.onerror?.();
    expect(indicator?.className).toBe("polling");
    expect(indicator?.textContent).toMatch(/polling/);

    // Now the status endpoint itself stops answering: a poll tick (fired
    // here directly, the way the real 10 s timer would) that fails must
    // flip the indicator to down — this is the real fallback failing, not
    // a class hardcoded on the element. The onerror handler above already
    // started a refresh() that is still in flight (gate was true when it
    // read it) — the sequence guard in refresh() must stop that stale,
    // eventually-successful call from clobbering this one back to
    // "polling" once it lands after this one already reported down.
    statusGate.ok = false;
    page.firePoll();
    await vi.waitFor(() => {
      expect(indicator?.className).toBe("down");
    });
    expect(indicator?.textContent).toMatch(/unreachable/);

    // Connectivity returns: the next poll tick itself (not the SSE drop
    // handler, which would set "polling" regardless of the fetch outcome)
    // must climb the indicator back out of "down" on its own.
    statusGate.ok = true;
    page.firePoll();
    await vi.waitFor(() => {
      expect(indicator?.className).toBe("polling");
    });
  });

  test("an SSE status arriving while a poll is pending wins — the late poll changes neither the table nor the indicator", async () => {
    const sseStatus = statusAt({ fixed: "from-sse" });
    const stalePollStatus = statusAt({ fixed: "from-stale-poll" });

    let resolveSlowPoll!: (res: Response) => void;
    const pendingPoll = new Promise<Response>((resolve) => {
      resolveSlowPoll = resolve;
    });

    const page = await loadPage(statusAt(), undefined, {
      statusResponder: (callIndex) => {
        // Call 1 is the page's own initial load — it must resolve so
        // loadPage's waitFor below is not left hanging on a Promise that
        // never settles. Every call after that (the onerror-triggered
        // poll below) hangs on `pendingPoll` until the test resolves it.
        if (callIndex === 1) {
          return new Response(JSON.stringify(statusAt()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return pendingPoll;
      },
    });
    const doc = page.window.document;
    const indicator = doc.getElementById("connection") as HTMLElement | null;
    const findings = () =>
      doc.querySelector("tr.lane td:last-child")?.textContent ?? "";

    // The stream drops, which starts a fallback poll (call 2) — it is
    // now in flight, awaiting `pendingPoll`.
    page.source.onerror?.();
    expect(indicator?.className).toBe("polling");

    // SSE reconnects and delivers a status event while that poll is still
    // pending. Its data must land, and the indicator must say live.
    page.source.emit("status", JSON.stringify(sseStatus));
    expect(findings()).toContain("from-sse");
    expect(indicator?.className).toBe("live");

    // The stale poll finally resolves, with different content. It must
    // change nothing: the table still shows the SSE payload, not the
    // poll's, and the indicator is untouched.
    resolveSlowPoll(
      new Response(JSON.stringify(stalePollStatus), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(findings()).toContain("from-sse");
    expect(findings()).not.toContain("from-stale-poll");
    expect(indicator?.className).toBe("live");
  });

  test("a poll that fails while the stream is healthy leaves the indicator live, not down", async () => {
    let settlePendingPoll!: (res: Response | Promise<Response>) => void;
    const pendingPoll = new Promise<Response>((resolve) => {
      settlePendingPoll = resolve;
    });

    const page = await loadPage(statusAt(), undefined, {
      statusResponder: (callIndex) => {
        // Same shape as above: call 1 feeds loadPage's own load, every
        // call after that hangs until the test settles it.
        if (callIndex === 1) {
          return new Response(JSON.stringify(statusAt()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return pendingPoll;
      },
    });
    const doc = page.window.document;
    const indicator = doc.getElementById("connection") as HTMLElement | null;

    // The stream drops, starting a fallback poll (call 2) — in flight,
    // awaiting `pendingPoll`.
    page.source.onerror?.();
    expect(indicator?.className).toBe("polling");

    // The stream comes back up while that poll is still pending — a
    // reconnect the real EventSource fires as another `onopen`.
    page.source.onopen?.();
    expect(indicator?.className).toBe("live");

    // The stale poll now fails. The connection is healthy — this must not
    // be read as "the connection is down".
    settlePendingPoll(Promise.reject(new Error("status fetch failed")));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(indicator?.className).toBe("live");
    expect(indicator?.textContent).toMatch(/live/);
  });

  test("a late log response does not overwrite a newer opened lane's header, size, or body", async () => {
    const twoLanesStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
            {
              wave: "T",
              lane: "t2",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let resolveT1!: (res: Response) => void;
    const pT1 = new Promise<Response>((resolve) => {
      resolveT1 = resolve;
    });

    let resolveT2!: (res: Response) => void;
    const pT2 = new Promise<Response>((resolve) => {
      resolveT2 = resolve;
    });

    const page = await loadPage(twoLanesStatus, (url) => {
      if (url.includes("/api/log/T/t1")) return pT1;
      if (url.includes("/api/log/T/t2")) return pT2;
      return new Response("not found", { status: 404 });
    });

    const doc = page.window.document;
    const rows = doc.querySelectorAll("tr.lane");
    expect(rows.length).toBe(2);

    // 1. Start opening lane T/t1 (pending)
    press(rows[0]!.querySelector("button")!, "Enter");

    // 2. Start opening lane T/t2 before T/t1 resolves
    press(rows[1]!.querySelector("button")!, "Enter");

    // 3. Resolve the second lane (T/t2) first
    resolveT2(new Response("log for t2", { status: 200 }));

    await vi.waitFor(() => {
      expect(doc.getElementById("log-lane")?.textContent).toBe("T/t2");
      expect(doc.getElementById("log-size")?.textContent).toBe("10 B");
      expect(doc.getElementById("log")?.textContent).toContain("log for t2");
    });

    // 4. Now let the first lane (T/t1) resolve later
    resolveT1(new Response("stale log for t1", { status: 200 }));

    // Give any asynchronous late handling an opportunity to misfire
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert header, size and body all remain belonging to the second lane
    expect(doc.getElementById("log-lane")?.textContent).toBe("T/t2");
    expect(doc.getElementById("log-size")?.textContent).toBe("10 B");
    expect(doc.getElementById("log")?.textContent).toContain("log for t2");
    expect(doc.getElementById("log")?.textContent).not.toContain(
      "stale log for t1",
    );
  });

  test("a log that resolves after a newer open does not move focus", async () => {
    const twoLanesStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
            {
              wave: "T",
              lane: "t2",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let resolveT1!: (res: Response) => void;
    const pT1 = new Promise<Response>((resolve) => {
      resolveT1 = resolve;
    });

    let resolveT2!: (res: Response) => void;
    const pT2 = new Promise<Response>((resolve) => {
      resolveT2 = resolve;
    });

    const page = await loadPage(twoLanesStatus, (url) => {
      if (url.includes("/api/log/T/t1")) return pT1;
      if (url.includes("/api/log/T/t2")) return pT2;
      return new Response("not found", { status: 404 });
    });

    const doc = page.window.document;
    const rows = doc.querySelectorAll("tr.lane");
    const logPane = doc.getElementById("log-pane");
    const row0Btn = rows[0]!.querySelector("button")!;
    const row1Btn = rows[1]!.querySelector("button")!;

    // 1. Start opening lane T/t1 (pending)
    press(row0Btn, "Enter");

    // 2. Start opening lane T/t2 before T/t1 resolves
    press(row1Btn, "Enter");
    row1Btn.focus();
    expect(doc.activeElement).toBe(row1Btn);

    // 3. Stale T/t1 resolves while T/t2 is still pending
    resolveT1(new Response("stale log for t1", { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stale resolution must NOT move focus to the pane
    expect(doc.activeElement).toBe(row1Btn);
    expect(doc.activeElement).not.toBe(logPane);

    // 4. Newer T/t2 resolves — it is newest, so it moves focus to the pane
    resolveT2(new Response("log for t2", { status: 200 }));
    await vi.waitFor(() => {
      expect(doc.activeElement).toBe(logPane);
    });
  });

  test("a lane switch with a render in between: the header, the size and the body all name the new lane", async () => {
    const twoLanesStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
            {
              wave: "T",
              lane: "t2",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let resolveT1Open!: (res: Response) => void;
    const pT1Open = new Promise<Response>((resolve) => {
      resolveT1Open = resolve;
    });
    let resolveT1Follow!: (res: Response) => void;
    const pT1Follow = new Promise<Response>((resolve) => {
      resolveT1Follow = resolve;
    });
    let resolveT2Open!: (res: Response) => void;
    const pT2Open = new Promise<Response>((resolve) => {
      resolveT2Open = resolve;
    });

    let t1Calls = 0;
    const page = await loadPage(twoLanesStatus, (url) => {
      if (url.includes("/api/log/T/t1")) {
        t1Calls++;
        return t1Calls === 1 ? pT1Open : pT1Follow;
      }
      if (url.includes("/api/log/T/t2")) return pT2Open;
      return new Response("not found", { status: 404 });
    });

    const doc = page.window.document;
    const rows = doc.querySelectorAll("tr.lane");
    expect(rows.length).toBe(2);

    // 1. Open lane t1 and turn follow on for it.
    press(rows[0]!.querySelector("button")!, "Enter");
    resolveT1Open(new Response("t1 initial", { status: 200 }));
    await vi.waitFor(() => {
      const checkbox = doc.getElementById("log-follow");
      expect(checkbox).not.toBeNull();
    });
    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckbox.checked = true;
    const changeEvent = new (
      followCheckbox.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    followCheckbox.dispatchEvent(changeEvent);
    // The change listener above started a follow refresh for t1 — it is
    // now in flight, awaiting pT1Follow.

    // 2. Switch to t2 while that follow refresh for t1 is still pending.
    press(rows[1]!.querySelector("button")!, "Enter");

    // 3. A status render lands mid-switch — the follow path's other
    // trigger — before either pending fetch resolves.
    page.source.emit("status", JSON.stringify(twoLanesStatus));

    // 4. The stale t1 follow refresh resolves. It must never reach the
    // screen: t2 is the active lane now.
    resolveT1Follow(new Response("stale t1 follow content", { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 5. t2's own open request resolves.
    resolveT2Open(new Response("t2 content", { status: 200 }));

    await vi.waitFor(() => {
      expect(doc.getElementById("log-lane")?.textContent).toBe("T/t2");
      expect(doc.getElementById("log-size")?.textContent).toBe("10 B");
      expect(doc.getElementById("log")?.textContent).toContain("t2 content");
    });
    expect(doc.getElementById("log")?.textContent).not.toContain(
      "stale t1 follow content",
    );
  });

  test("copy reports failure and does not claim success when clipboard API is absent or writeText rejects", async () => {
    const page = await loadPage(statusAt(), "sample log");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
    });

    const copyBtn = doc.querySelector(
      'button[aria-label="copy"]',
    ) as unknown as HTMLElement;

    // A: navigator.clipboard absent
    Object.defineProperty(page.window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    copyBtn.click();
    await vi.waitFor(() => {
      expect(copyBtn.textContent?.trim()).not.toBe("copied");
      expect(copyBtn.textContent?.trim()).toBe("copy failed");
    });

    // B: writeText rejects
    Object.defineProperty(page.window.navigator, "clipboard", {
      value: {
        writeText: vi
          .fn()
          .mockRejectedValue(new Error("clipboard permission denied")),
      },
      configurable: true,
    });
    copyBtn.click();
    await vi.waitFor(() => {
      expect(copyBtn.textContent?.trim()).not.toBe("copied");
      expect(copyBtn.textContent?.trim()).toBe("copy failed");
    });
  });

  test("copy selects .line nodes directly and ignores gutter even if user-select is auto", async () => {
    const multiline = "alpha\nbeta\ngamma";
    const page = await loadPage(statusAt(), multiline);
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    // Wait for the fetched body, not just the pane's visibility — the pane
    // is revealed before the log tail fetch resolves.
    await vi.waitFor(() => {
      expect(doc.querySelectorAll(".gutter").length).toBe(3);
    });

    // Gutter user-select set to auto (e.g. style change)
    const gutters = doc.querySelectorAll(".gutter");
    expect(gutters.length).toBe(3);
    for (const gutter of gutters) {
      gutter.setAttribute("style", "user-select: auto");
      expect(page.window.getComputedStyle(gutter).userSelect).toBe("auto");
    }

    const copyBtn = doc.querySelector(
      'button[aria-label="copy"]',
    ) as unknown as HTMLElement;
    copyBtn.click();

    await vi.waitFor(async () => {
      const text = await page.window.navigator.clipboard.readText();
      expect(text).toBe(multiline);
    });
  });

  test("a tail whose first bytes are a split multi-byte character reports the served byte length", async () => {
    const splitBytes = new Uint8Array([0x80, 0x61, 0x62]);
    const page = await loadPage(statusAt(), splitBytes);
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");

    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
      expect(doc.getElementById("log-size")?.textContent).toBe("3 B");
    });
  });

  test("at a narrow width every toolbar control is still reachable", async () => {
    const page = await loadPage(statusAt(), "log content", { width: 320 });
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
    });

    const toolbar = doc.getElementById("log-toolbar");
    expect(toolbar).not.toBeNull();
    expect(page.window.getComputedStyle(toolbar!).flexWrap).toBe("wrap");

    const expandBtn = toolbar?.querySelector('button[aria-label="expand"]');
    const copyBtn = toolbar?.querySelector('button[aria-label="copy"]');
    const downloadBtn = toolbar?.querySelector('button[aria-label="download"]');
    const closeBtn = toolbar?.querySelector('button[aria-label="close"]');

    for (const btn of [expandBtn, copyBtn, downloadBtn, closeBtn]) {
      expect(btn).not.toBeNull();
      expect((btn as unknown as HTMLElement)?.hidden).toBe(false);
      expect(page.window.getComputedStyle(btn!).display).not.toBe("none");
    }
  });

  test("every control in the toolbar resolves its border to the control token and frames keep the frame token", async () => {
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    const sheet = doc.styleSheets[0];
    const style = await pageStyle();

    interface StyleRuleLike {
      readonly selectorText: string;
      readonly style: {
        readonly borderColor?: string;
        readonly borderBottomColor?: string;
        readonly border?: string;
      };
    }

    const rules = Array.from(
      sheet.cssRules,
    ) as unknown as readonly StyleRuleLike[];

    const controls = doc.querySelectorAll("#log-toolbar button");
    expect(controls.length).toBeGreaterThan(0);

    for (const control of controls) {
      const rule = rules.find(
        (r) =>
          r.selectorText !== undefined &&
          !r.selectorText.includes(":") &&
          control.matches(r.selectorText) &&
          Boolean(r.style.borderColor || r.style.border),
      );
      expect(rule?.style.borderColor).toBe("var(--color-border-control)");
    }

    const hoverRule = rules.find(
      (r) => r.selectorText === "#log-toolbar button:hover",
    );
    expect(hoverRule?.style.borderColor).toBe(
      "var(--color-border-control-hover)",
    );

    // At least one frame still resolves to the frame token
    const frame = doc.getElementById("log-pane");
    expect(frame).not.toBeNull();
    const frameRule = rules.find(
      (r) =>
        r.selectorText !== undefined &&
        !r.selectorText.includes(":") &&
        frame!.matches(r.selectorText) &&
        Boolean(r.style.borderColor || r.style.border),
    );
    expect(frameRule?.style.borderColor).toBe("var(--color-border)");

    expect(style).toMatch(
      /#log-toolbar button\s*\{[^}]*border:\s*1px solid var\(--color-border-control\)/,
    );
    expect(style).toMatch(
      /#log-toolbar button:hover\s*\{[^}]*border-color:\s*var\(--color-border-control-hover\)/,
    );
  });

  test("pressing download targets the current lane's full=1 URL, performs no fetch, and names the same lane in the download attribute", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const rows = doc.querySelectorAll("tr.lane");
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const downloads: Array<{ href: string; download: string }> = [];
    const origCreateElement = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation(
      (tagName: string, ...args) => {
        const el = origCreateElement(tagName, ...args);
        if (tagName.toLowerCase() === "a") {
          vi.spyOn(el, "click").mockImplementation(() => {
            downloads.push({
              href:
                el.getAttribute("href") ??
                (el as unknown as { href: string }).href,
              download:
                el.getAttribute("download") ??
                (el as unknown as { download: string }).download,
            });
          });
        }
        return el;
      },
    );

    // Open first lane: T/t1
    press(rows[0]!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
      expect(doc.getElementById("log-lane")?.textContent).toBe("T/t1");
    });

    const downloadBtn = doc.querySelector(
      'button[aria-label="download"]',
    ) as HTMLElement | null;
    expect(downloadBtn).not.toBeNull();

    const fetchesAfterLane1 = page.fetches.length;
    downloadBtn?.click();

    expect(downloads).toEqual([
      { href: "/api/log/T/t1?full=1", download: "T-t1.log" },
    ]);
    expect(page.fetches.length).toBe(fetchesAfterLane1);
    expect(page.fetches.filter((url) => url.includes("full=1"))).toHaveLength(
      0,
    );

    // Switch to second lane: T/t2
    press(rows[1]!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(doc.getElementById("log-lane")?.textContent).toBe("T/t2");
    });

    const fetchesAfterLane2 = page.fetches.length;
    downloadBtn?.click();

    expect(downloads).toEqual([
      { href: "/api/log/T/t1?full=1", download: "T-t1.log" },
      { href: "/api/log/T/t2?full=1", download: "T-t2.log" },
    ]);
    expect(page.fetches.length).toBe(fetchesAfterLane2);
    expect(page.fetches.filter((url) => url.includes("full=1"))).toHaveLength(
      0,
    );
  });

  test("every wave renders collapsed, and its lanes are not present or not visible until it is opened", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveRows = doc.querySelectorAll("tr.wave");
    expect(waveRows.length).toBe(2);

    for (const waveRow of waveRows) {
      expect(
        waveRow.querySelector("button")?.getAttribute("aria-expanded"),
      ).toBe("false");
    }

    const laneRows = doc.querySelectorAll("tr.lane");
    expect(laneRows.length).toBe(5);
    for (const laneRow of laneRows) {
      expect((laneRow as unknown as HTMLElement).hidden).toBe(true);
    }
  });

  test("opening a wave reveals its lanes and their disagreement rows; closing hides both", async () => {
    const statusWithDisagreement: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "w1",
              derived: { alive: true },
              disagreements: ["lane disagreement banner"],
            },
            {
              wave: "W",
              lane: "w2",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(statusWithDisagreement);
    const doc = page.window.document;
    const waveRow = doc.querySelector("tr.wave") as unknown as HTMLElement;
    const laneRows = doc.querySelectorAll("tr.lane");
    const disagreementRows = doc.querySelectorAll("tr.disagreement");
    expect(laneRows.length).toBe(2);
    expect(disagreementRows.length).toBe(1);

    // Initially collapsed
    expect((laneRows[0] as unknown as HTMLElement | undefined)?.hidden).toBe(
      true,
    );
    expect((laneRows[1] as unknown as HTMLElement | undefined)?.hidden).toBe(
      true,
    );
    expect(
      (disagreementRows[0] as unknown as HTMLElement | undefined)?.hidden,
    ).toBe(true);

    const waveButton = waveRow.querySelector("button")!;

    // Open wave
    waveRow.click();
    expect(waveButton.getAttribute("aria-expanded")).toBe("true");
    expect((laneRows[0] as unknown as HTMLElement | undefined)?.hidden).toBe(
      false,
    );
    expect((laneRows[1] as unknown as HTMLElement | undefined)?.hidden).toBe(
      false,
    );
    expect(
      (disagreementRows[0] as unknown as HTMLElement | undefined)?.hidden,
    ).toBe(false);

    // Close wave
    waveRow.click();
    expect(waveButton.getAttribute("aria-expanded")).toBe("false");
    expect((laneRows[0] as unknown as HTMLElement | undefined)?.hidden).toBe(
      true,
    );
    expect((laneRows[1] as unknown as HTMLElement | undefined)?.hidden).toBe(
      true,
    );
    expect(
      (disagreementRows[0] as unknown as HTMLElement | undefined)?.hidden,
    ).toBe(true);
  });

  test("the wave row's button is reachable by keyboard and carries aria-expanded in both states", async () => {
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    const waveRow = doc.querySelector("tr.wave") as unknown as HTMLElement;
    expect(waveRow).not.toBeNull();
    expect(waveRow.getAttribute("role")).not.toBe("button");
    expect(waveRow.getAttribute("tabindex")).toBeNull();
    const button = waveRow.querySelector("button")!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("tabindex")).toBe("0");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    press(button, "Enter");
    expect(button.getAttribute("aria-expanded")).toBe("true");

    press(button, " ");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("the wave row shows which wave it is and how many lanes are inside", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveRows = doc.querySelectorAll("tr.wave");
    expect(waveRows[0]?.textContent).toContain("wave T");
    expect(waveRows[0]?.textContent).toContain("4 lanes");
    expect(waveRows[1]?.textContent).toContain("wave U");
    expect(waveRows[1]?.textContent).toContain("1 lane");
  });

  test("an opened wave is still open after a re-render", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveRows = doc.querySelectorAll("tr.wave");
    expect(waveRows.length).toBe(2);

    const waveT = waveRows[0] as unknown as HTMLElement;
    const waveU = waveRows[1] as unknown as HTMLElement;
    expect(waveT.dataset.wave).toBe("T");
    expect(waveU.dataset.wave).toBe("U");

    // Open wave T
    waveT.click();
    expect(waveT.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(waveU.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "false",
    );

    // Re-render via SSE status event
    page.source.emit("status", JSON.stringify(mixedStatus));

    const updatedWaveRows = doc.querySelectorAll("tr.wave");
    const updatedWaveT = updatedWaveRows[0] as unknown as HTMLElement;
    const updatedWaveU = updatedWaveRows[1] as unknown as HTMLElement;

    expect(
      updatedWaveT.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      updatedWaveU.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("false");

    const lanesT = doc.querySelectorAll(
      'tr.lane[data-wave="T"]',
    ) as unknown as NodeListOf<HTMLElement>;
    for (const lane of lanesT) {
      expect(lane.hidden).toBe(false);
    }
    const lanesU = doc.querySelectorAll(
      'tr.lane[data-wave="U"]',
    ) as unknown as NodeListOf<HTMLElement>;
    for (const lane of lanesU) {
      expect(lane.hidden).toBe(true);
    }
  });

  test("a re-render leaves the focused wave's button focused, and a vanished row gets nothing back", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveT = doc.querySelector(
      'tr.wave[data-wave="T"]',
    ) as unknown as HTMLElement;
    const waveTButton = waveT.querySelector("button")!;
    waveTButton.focus();
    expect(doc.activeElement).toBe(waveTButton);

    page.source.emit("status", JSON.stringify(mixedStatus));
    const reRendered = doc.querySelector(
      'tr.wave[data-wave="T"]',
    ) as unknown as HTMLElement;
    const reRenderedButton = reRendered.querySelector("button")!;
    expect(reRendered).not.toBe(waveT);
    expect(doc.activeElement).toBe(reRenderedButton);

    // A wave that is gone is gone: do not guess at a neighbour row.
    const withoutTwo: WaveStatus = {
      generatedAt: "now",
      waves: mixedStatus.waves.filter((wave) => wave.id !== "T"),
    };
    page.source.emit("status", JSON.stringify(withoutTwo));
    expect(doc.querySelector('tr.wave[data-wave="T"]')).toBeNull();
    expect(doc.activeElement).toBe(doc.body);
  });

  test("with sorting on, focus follows lane identity across a re-render, not row position", async () => {
    const before: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "l_hot",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_cold",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;
    const after: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "l_hot",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_cold",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(before);
    const doc = page.window.document;
    (doc.querySelector("tr.wave") as unknown as HTMLElement).click();
    const hot = doc.querySelector(
      'tr.lane[data-lane="l_hot"]',
    ) as unknown as HTMLElement;
    const hotButton = hot.querySelector("button")!;
    hotButton.focus();
    expect(doc.activeElement).toBe(hotButton);
    expect(
      (doc.querySelectorAll("tr.lane")[0] as unknown as HTMLElement).dataset
        .lane,
    ).toBe("l_hot");

    page.source.emit("status", JSON.stringify(after));

    // Prove the re-sort actually happened: l_cold is now the more recently
    // updated lane, so it must lead and l_hot must have moved off row 0. If
    // sorting silently stopped working, l_hot would stay at index 0 and a
    // position-based focus restore would satisfy the assertions below just
    // as well as an identity-based one — this is what rules that out.
    const rowsAfter = doc.querySelectorAll("tr.lane");
    expect((rowsAfter[0] as unknown as HTMLElement).dataset.lane).toBe(
      "l_cold",
    );
    expect((rowsAfter[1] as unknown as HTMLElement).dataset.lane).toBe("l_hot");

    const hotAgain = doc.querySelector(
      'tr.lane[data-lane="l_hot"]',
    ) as unknown as HTMLElement;
    const hotAgainButton = hotAgain.querySelector("button")!;
    expect(hotAgain).not.toBe(hot);
    expect(hotAgain).toBe(rowsAfter[1]);
    expect(doc.activeElement).toBe(hotAgainButton);
  });

  test("each wave control names the one element that holds its rows, and the names are unique", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.length).toBe(2);

    const seen = new Set<string>();
    for (const waveRow of waveRows) {
      const control = waveRow
        .querySelector("button")
        ?.getAttribute("aria-controls");
      expect(control).toBeTruthy();
      expect(seen.has(control!)).toBe(false);
      seen.add(control!);
      const group = doc.getElementById(control!);
      expect(group).not.toBeNull();
      for (const lane of group!.querySelectorAll("tr.lane")) {
        expect(lane.getAttribute("data-wave")).toBe(
          waveRow.getAttribute("data-wave"),
        );
      }
    }
  });

  test("with sorting on, a lane whose log.mtimeMs is newest appears first, and a lane with no log is last", async () => {
    const statusWithMtimes: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "l_mid",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 2000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_old",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_new",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_nolog",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(statusWithMtimes);
    const doc = page.window.document;
    const lanes = Array.from(doc.querySelectorAll('tr.lane[data-wave="W"]'));
    expect(lanes.length).toBe(4);

    const laneIds = lanes.map((el) => el.getAttribute("data-lane"));
    expect(laneIds[0]).toBe("l_new");
    expect(laneIds[1]).toBe("l_mid");
    expect(laneIds[2]).toBe("l_old");
    expect(laneIds[3]).toBe("l_nolog");
  });

  test("with sorting on, the wave whose most recent lane is newest renders first, with every wave collapsed", async () => {
    const statusWithWaves: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W_mid",
          lanes: [
            {
              wave: "W_mid",
              lane: "l_mid",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 2000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_old",
          lanes: [
            {
              wave: "W_old",
              lane: "l_old",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_new",
          lanes: [
            {
              wave: "W_new",
              lane: "l_new",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(statusWithWaves);
    const doc = page.window.document;

    // Assert every wave is collapsed by default (the reported case)
    const waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.length).toBe(3);
    for (const waveRow of waveRows) {
      expect(
        waveRow.querySelector("button")?.getAttribute("aria-expanded"),
      ).toBe("false");
    }
    const laneRows = Array.from(doc.querySelectorAll("tr.lane"));
    expect(laneRows.length).toBe(3);
    for (const laneRow of laneRows) {
      expect((laneRow as unknown as HTMLElement).hidden).toBe(true);
    }

    // With sorting on, W_new (3600) renders first, followed by W_mid (2000), then W_old (1000)
    const waveIds = waveRows.map((el) => el.getAttribute("data-wave"));
    expect(waveIds).toEqual(["W_new", "W_mid", "W_old"]);
    expect(waveIds[0]).toBe("W_new");
  });

  test("flipping the switch off restores server order at both levels", async () => {
    const multiLevelStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W_server1",
          lanes: [
            {
              wave: "W_server1",
              lane: "l_s1_old",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W_server1",
              lane: "l_s1_new",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 2000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_server2",
          lanes: [
            {
              wave: "W_server2",
              lane: "l_s2_old",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W_server2",
              lane: "l_s2_new",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 4_800, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(multiLevelStatus);
    const doc = page.window.document;
    const switchEl = doc.getElementById(
      "sort-switch",
    ) as unknown as HTMLElement;
    expect(switchEl).not.toBeNull();
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    // Initially sorted newest first at both wave and lane levels
    let waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.map((w) => w.getAttribute("data-wave"))).toEqual([
      "W_server2",
      "W_server1",
    ]);
    let lanesW2 = Array.from(
      doc.querySelectorAll('tr.lane[data-wave="W_server2"]'),
    );
    expect(lanesW2.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_s2_new",
      "l_s2_old",
    ]);
    let lanesW1 = Array.from(
      doc.querySelectorAll('tr.lane[data-wave="W_server1"]'),
    );
    expect(lanesW1.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_s1_new",
      "l_s1_old",
    ]);

    // Flip switch off
    switchEl.click();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    // Server order is restored at both levels
    waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.map((w) => w.getAttribute("data-wave"))).toEqual([
      "W_server1",
      "W_server2",
    ]);
    lanesW1 = Array.from(
      doc.querySelectorAll('tr.lane[data-wave="W_server1"]'),
    );
    expect(lanesW1.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_s1_old",
      "l_s1_new",
    ]);
    lanesW2 = Array.from(
      doc.querySelectorAll('tr.lane[data-wave="W_server2"]'),
    );
    expect(lanesW2.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_s2_old",
      "l_s2_new",
    ]);

    // Flip switch on again
    switchEl.click();
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.map((w) => w.getAttribute("data-wave"))).toEqual([
      "W_server2",
      "W_server1",
    ]);
    lanesW2 = Array.from(
      doc.querySelectorAll('tr.lane[data-wave="W_server2"]'),
    );
    expect(lanesW2.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_s2_new",
      "l_s2_old",
    ]);
    lanesW1 = Array.from(
      doc.querySelectorAll('tr.lane[data-wave="W_server1"]'),
    );
    expect(lanesW1.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_s1_new",
      "l_s1_old",
    ]);
  });

  test("a wave with no timestamped lane sorts last", async () => {
    const statusWithNoTimestamp: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W_nolog",
          lanes: [
            {
              wave: "W_nolog",
              lane: "l_none",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_empty",
          lanes: [],
        },
        {
          id: "W_old",
          lanes: [
            {
              wave: "W_old",
              lane: "l_old",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_new",
          lanes: [
            {
              wave: "W_new",
              lane: "l_new",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(statusWithNoTimestamp);
    const doc = page.window.document;
    const waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    const waveIds = waveRows.map((el) => el.getAttribute("data-wave"));
    expect(waveIds).toEqual(["W_new", "W_old", "W_nolog", "W_empty"]);
  });

  test("a collapsed page with sorting off lists the newest wave first because the collector sent it first, and every header states its wave's age", async () => {
    // The state the sort defect hid in: waves collapsed and the recent-sort
    // switch off, so the list order is purely what the server sent. The
    // directories are named so that lexicographic order and recency disagree
    // (wave-10 < wave-9), and the lane mtimes decide: wave-9 ran half an hour
    // ago, wave-10 three days ago.
    const root = mkdtempSync(join(tmpdir(), "wave-age-order-"));
    dirs.push(root);
    mkdirSync(join(root, "wave-9"));
    mkdirSync(join(root, "wave-10"));
    writeFileSync(join(root, "wave-9", "a.log"), "building\n");
    writeFileSync(join(root, "wave-10", "b.log"), "settled long ago\n");
    writeFileSync(
      join(root, "wave-9", "events.jsonl"),
      '{"ts":"2026-09-07T16:55:00Z","wave":"9","lane":"a","stage":"implement","event":"started"}\n',
    );
    writeFileSync(
      join(root, "wave-10", "events.jsonl"),
      '{"ts":"2026-09-04T16:55:00Z","wave":"10","lane":"b","stage":"merge","event":"settled"}\n',
    );
    const base = Date.now();
    const mtime9 = new Date(base - 30 * 60_000);
    const mtime10 = new Date(base - 3 * 24 * 60 * 60_000);
    utimesSync(join(root, "wave-9", "a.log"), mtime9, mtime9);
    utimesSync(join(root, "wave-10", "b.log"), mtime10, mtime10);

    const status = await collect(fixtureDeps(), root, new Date().toISOString());

    const page = await loadPage(status, "log-tail", {
      storage: { "wave-status:sort": "false" },
    });
    const doc = page.window.document;

    // Collapsed — the state where the old defect was invisible to expanded-only tests.
    const waveRows = Array.from(
      doc.querySelectorAll("tr.wave"),
    ) as unknown as HTMLElement[];
    for (const waveRow of waveRows) {
      expect(
        waveRow.querySelector("button")?.getAttribute("aria-expanded"),
      ).toBe("false");
    }
    const laneRows = Array.from(
      doc.querySelectorAll("tr.lane"),
    ) as unknown as HTMLElement[];
    expect(laneRows.length).toBe(2);
    for (const laneRow of laneRows) {
      expect(laneRow.hidden).toBe(true);
    }

    // Newest wave first, straight from the server payload.
    expect(waveRows.map((el) => el.getAttribute("data-wave"))).toEqual([
      "9",
      "10",
    ]);

    // And each collapsed header carries its age in words a reader can see —
    // not a hidden lane row, not just a helper's return value.
    expect(waveRows[0]?.textContent).toContain("30m ago");
    expect(waveRows[1]?.textContent).toContain("3d ago");
  });

  test("a collapsed page puts a silent newer wave ahead of an older wave that reported events", async () => {
    // The one-feed shape: wave-8 reported its merge and went quiet; wave-9 is
    // the live wave and has said nothing but its own start. With the client's
    // own sort off, the list order is purely what the collector sent — which
    // is where the event-feed-first ordering used to surface, as an old wave
    // on top.
    const root = mkdtempSync(join(tmpdir(), "wave-quiet-order-"));
    dirs.push(root);
    mkdirSync(join(root, "wave-8"));
    mkdirSync(join(root, "wave-9"));
    writeFileSync(
      join(root, "wave-8", "events.jsonl"),
      '{"ts":"2026-09-07T16:55:00Z","wave":"8","lane":"a","stage":"merge","event":"settled","pr":301}\n',
    );
    writeFileSync(join(root, "wave-8", "a.log"), "settled long ago\n");
    writeFileSync(join(root, "wave-9", "b.log"), "building right now\n");
    writeFileSync(
      join(root, "wave-9", "events.jsonl"),
      '{"ts":"2026-09-08T10:00:00Z","wave":"9","lane":"b","stage":"implement","event":"started"}\n',
    );
    const base = Date.now();
    const mtime8 = new Date(base - 60 * 60_000);
    const mtime9 = new Date(base - 2 * 60_000);
    utimesSync(join(root, "wave-8", "a.log"), mtime8, mtime8);
    utimesSync(join(root, "wave-9", "b.log"), mtime9, mtime9);

    const status = await collect(fixtureDeps(), root, new Date().toISOString());

    const page = await loadPage(status, "log-tail", {
      storage: { "wave-status:sort": "false" },
    });
    const doc = page.window.document;

    const waveRows = Array.from(
      doc.querySelectorAll("tr.wave"),
    ) as unknown as HTMLElement[];
    for (const waveRow of waveRows) {
      expect(
        waveRow.querySelector("button")?.getAttribute("aria-expanded"),
      ).toBe("false");
    }
    expect(waveRows.map((el) => el.getAttribute("data-wave"))).toEqual([
      "9",
      "8",
    ]);
  });

  test("wave headers state age relative and short — now, minutes, hours, days — and say 'no dated activity' rather than lie", async () => {
    const now = Date.now();
    const dated = (
      id: string,
      mtimeMs: number,
    ): { id: string; lanes: unknown[] } => ({
      id,
      lanes: [
        {
          wave: id,
          lane: "l",
          derived: { alive: false, log: { bytes: 10, mtimeMs, tail: "" } },
          disagreements: [],
        },
      ],
    });
    const ageStatus = {
      generatedAt: "now",
      waves: [
        dated("W_secs", now - 30_000),
        dated("W_mins", now - 22.5 * 60_000),
        dated("W_hours", now - 3.5 * 60 * 60_000),
        dated("W_days", now - 5.5 * 24 * 60 * 60_000),
        dated("W_future", now + 10 * 60_000),
        {
          id: "W_nolog",
          lanes: [
            {
              wave: "W_nolog",
              lane: "l",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
        { id: "W_empty", lanes: [] },
      ],
    } as unknown as WaveStatus;

    const page = await loadPage(ageStatus, "log-tail", {
      storage: { "wave-status:sort": "false" },
    });
    const doc = page.window.document;

    // Every wave is collapsed; the header is the only thing the reader sees.
    const waveRows = Array.from(
      doc.querySelectorAll("tr.wave"),
    ) as unknown as HTMLElement[];
    for (const waveRow of waveRows) {
      expect(
        waveRow.querySelector("button")?.getAttribute("aria-expanded"),
      ).toBe("false");
    }

    const ageOf = (id: string): string => {
      const row = doc.querySelector(
        `tr.wave[data-wave="${id}"]`,
      ) as unknown as HTMLElement;
      expect(row).not.toBeNull();
      const expected = row.querySelector(".wave-age")?.textContent ?? "";
      // The reader-visible string, asserted on the header's own text.
      expect(row.textContent).toContain(expected);
      return expected;
    };

    expect(ageOf("W_secs")).toBe("now");
    expect(ageOf("W_mins")).toBe("22m ago");
    expect(ageOf("W_hours")).toBe("3h ago");
    expect(ageOf("W_days")).toBe("5d ago");
    // A clock-ahead mtime must not render as a negative age.
    expect(ageOf("W_future")).toBe("now");
    // Nothing to date says so plainly — no fabricated age for an undated wave.
    expect(ageOf("W_nolog")).toBe("no dated activity");
    expect(ageOf("W_empty")).toBe("no dated activity");
  });

  test("a quiet wave's age keeps advancing on the page's own tick, with no status arriving", async () => {
    // The defect: the live path renders only when the server pushes, and the
    // server is silent while nothing changes — so a quiet wave's header froze
    // at the first age it read and went on telling a reader the lane had been
    // active more recently than it was.
    const html = await readFile(PAGE_PATH, "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const tick = Number(
      /AGE_TICK_MS\s*=\s*([0-9_]+)/.exec(script)?.[1]?.replace(/_/g, ""),
    );
    // The tick must exist, and run finer than the smallest bin the header
    // displays (a minute) — a coarser one just re-freezes the age between ticks.
    expect(Number.isFinite(tick)).toBe(true);
    expect(tick).toBeGreaterThan(0);
    expect(tick).toBeLessThanOrEqual(60_000);

    const base = Date.UTC(2026, 8, 11, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => base);
    try {
      const quietStatus = {
        generatedAt: "now",
        waves: [
          {
            id: "9",
            lanes: [
              {
                wave: "9",
                lane: "a",
                derived: {
                  alive: false,
                  log: { bytes: 10, mtimeMs: base - 90_000, tail: "" },
                },
                disagreements: [],
              },
            ],
          },
        ],
      } as unknown as WaveStatus;

      const page = await loadPage(quietStatus, "log-tail", {
        storage: { "wave-status:sort": "false" },
      });
      const doc = page.window.document;
      const header = (): string =>
        (doc.querySelector('tr.wave[data-wave="9"]') as unknown as HTMLElement)
          ?.textContent ?? "";

      expect(header()).toContain("1m ago");

      // Two minutes of real time pass with nothing new from the server. The
      // fetch count is the proof no status arrived; the header must have aged.
      const fetches = page.fetches.length;
      nowSpy.mockImplementation(() => base + 120_000);
      page.fireInterval(tick);

      expect(page.fetches.length).toBe(fetches);
      expect(header()).toContain("3m ago");
      expect(header()).not.toContain("1m ago");
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("a collapsed header separates the wave id from its age, so one number is never read for two", async () => {
    const base = Date.UTC(2026, 8, 11, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => base);
    try {
      const page = await loadPage(
        {
          generatedAt: "now",
          waves: [
            {
              id: "9",
              lanes: [
                {
                  wave: "9",
                  lane: "a",
                  derived: {
                    alive: false,
                    log: { bytes: 10, mtimeMs: base - 2 * 60_000, tail: "" },
                  },
                  disagreements: [],
                },
              ],
            },
          ],
        } as unknown as WaveStatus,
        "log-tail",
        { storage: { "wave-status:sort": "false" } },
      );
      const button = page.window.document.querySelector(
        'tr.wave[data-wave="9"] button',
      ) as unknown as HTMLElement;
      const name = button.textContent ?? "";

      // The id and the age are flex children separated by `gap` alone, and gap
      // adds nothing to a flat accessible name: this header used to announce
      // "92m ago" for a wave that was two minutes old.
      expect(name).not.toContain("92m ago");
      expect(name).toContain("9 · 2m ago");
      // The separator belongs to the header, not to the age span the tick
      // rewrites, so no age can ever be rendered without one.
      expect(button.querySelector(".wave-age")?.textContent).toBe("2m ago");
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("an expanded wave stays expanded across a re-sort, and an open log stays open when its wave moves", async () => {
    const beforeStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W_A",
          lanes: [
            {
              wave: "W_A",
              lane: "l_a",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_B",
          lanes: [
            {
              wave: "W_B",
              lane: "l_b",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 2000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const afterStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W_A",
          lanes: [
            {
              wave: "W_A",
              lane: "l_a",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W_B",
          lanes: [
            {
              wave: "W_B",
              lane: "l_b",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 2000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(beforeStatus, "test log for W_A/l_a");
    const doc = page.window.document;

    // Initial state with sorting on: W_B (2000) is first, W_A (1000) is second
    let waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.map((r) => r.getAttribute("data-wave"))).toEqual([
      "W_B",
      "W_A",
    ]);

    // Expand W_A
    const waveAButton = doc.querySelector(
      'tr.wave[data-wave="W_A"] button',
    ) as unknown as HTMLElement;
    waveAButton.click();
    expect(waveAButton.getAttribute("aria-expanded")).toBe("true");
    const laneA = doc.querySelector(
      'tr.lane[data-wave="W_A"][data-lane="l_a"]',
    ) as unknown as HTMLElement;
    expect(laneA.hidden).toBe(false);

    // Open log for W_A / l_a
    laneA.click();
    await vi.waitFor(() => {
      expect(page.fetches).toContain("/api/log/W_A/l_a?tail=16");
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
    });
    expect(doc.getElementById("log-lane")?.textContent).toBe("W_A/l_a");
    expect(laneA.classList.contains("selected")).toBe(true);

    // Emit new status where W_A becomes newer (3600 > 2000)
    // This moves W_A from second to first row!
    page.source.emit("status", JSON.stringify(afterStatus));

    // Prove the re-sort moved W_A to the first position
    waveRows = Array.from(doc.querySelectorAll("tr.wave"));
    expect(waveRows.map((r) => r.getAttribute("data-wave"))).toEqual([
      "W_A",
      "W_B",
    ]);

    // W_A is still expanded after moving
    const waveAButtonAfter = doc.querySelector(
      'tr.wave[data-wave="W_A"] button',
    ) as unknown as HTMLElement;
    expect(waveAButtonAfter.getAttribute("aria-expanded")).toBe("true");
    const laneAAfter = doc.querySelector(
      'tr.lane[data-wave="W_A"][data-lane="l_a"]',
    ) as unknown as HTMLElement;
    expect(laneAAfter.hidden).toBe(false);

    // The open log is still open and the selected row is preserved on the moved lane
    const logPane = doc.getElementById("log-pane") as HTMLElement | null;
    expect(logPane?.hidden).toBe(false);
    expect(doc.getElementById("log-lane")?.textContent).toBe("W_A/l_a");
    expect(laneAAfter.classList.contains("selected")).toBe(true);

    // Now flip the sort switch off to restore server order (W_A, W_B)
    const switchEl = doc.getElementById(
      "sort-switch",
    ) as unknown as HTMLElement;
    switchEl.click();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
    expect(waveAButtonAfter.getAttribute("aria-expanded")).toBe("true");
    expect(logPane?.hidden).toBe(false);
    expect(doc.getElementById("log-lane")?.textContent).toBe("W_A/l_a");
    expect(laneAAfter.classList.contains("selected")).toBe(true);
  });

  test("the switch has an accessible name, flipping it restores the server order without a refresh, and the choice survives a reload", async () => {
    const statusWithMtimes: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "l_server1",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_server2",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(statusWithMtimes);
    const doc = page.window.document;
    const switchEl = doc.getElementById(
      "sort-switch",
    ) as unknown as HTMLElement;
    expect(switchEl).not.toBeNull();
    expect(switchEl.getAttribute("role")).toBe("switch");
    expect(switchEl.getAttribute("aria-label")).toBeTruthy();
    expect(switchEl.getAttribute("aria-label")).toMatch(/sort/i);
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    // Initially sorted newest first
    let lanes = Array.from(doc.querySelectorAll('tr.lane[data-wave="W"]'));
    expect(lanes.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_server2",
      "l_server1",
    ]);

    const fetchCountBefore = page.fetches.length;

    // Flip switch off
    switchEl.click();
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    // Server order is restored without any network fetch
    lanes = Array.from(doc.querySelectorAll('tr.lane[data-wave="W"]'));
    expect(lanes.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_server1",
      "l_server2",
    ]);
    expect(page.fetches.length).toBe(fetchCountBefore);

    // Stored preference is saved in localStorage
    expect(page.window.localStorage.getItem("wave-status:sort")).toBe("false");

    // Survives a reload
    const reloadedPage = await loadPage(statusWithMtimes, undefined, {
      storage: { "wave-status:sort": "false" },
    });
    const reloadedDoc = reloadedPage.window.document;
    const reloadedSwitch = reloadedDoc.getElementById(
      "sort-switch",
    ) as unknown as HTMLElement;
    expect(reloadedSwitch.getAttribute("aria-checked")).toBe("false");
    const reloadedLanes = Array.from(
      reloadedDoc.querySelectorAll('tr.lane[data-wave="W"]'),
    );
    expect(reloadedLanes.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_server1",
      "l_server2",
    ]);
  });

  test("a localStorage read that throws still renders with sorting on", async () => {
    const statusWithMtimes: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "l_old",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 1000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "l_new",
              derived: {
                alive: true,
                log: { bytes: 10, mtimeMs: 3_600, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(statusWithMtimes, undefined, {
      mockStorageError: true,
    });
    const doc = page.window.document;
    const switchEl = doc.getElementById(
      "sort-switch",
    ) as unknown as HTMLElement;
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    const lanes = Array.from(doc.querySelectorAll('tr.lane[data-wave="W"]'));
    expect(lanes.map((l) => l.getAttribute("data-lane"))).toEqual([
      "l_new",
      "l_old",
    ]);
  });

  test("the sort switch control resolves its border to the control token", async () => {
    const page = await loadPage(statusAt());
    const doc = page.window.document;
    const sheet = doc.styleSheets[0];
    const style = await pageStyle();

    interface StyleRuleLike {
      readonly selectorText: string;
      readonly style: {
        readonly borderColor?: string;
        readonly border?: string;
      };
    }

    const rules = Array.from(
      sheet.cssRules,
    ) as unknown as readonly StyleRuleLike[];
    const sortSwitch = doc.getElementById("sort-switch");
    expect(sortSwitch).not.toBeNull();

    const rule = rules.find(
      (r) =>
        r.selectorText !== undefined &&
        !r.selectorText.includes(":") &&
        sortSwitch!.matches(r.selectorText) &&
        Boolean(r.style.borderColor || r.style.border),
    );
    expect(rule?.style.borderColor).toBe("var(--color-border-control)");

    expect(style).toMatch(
      /#sort-switch\s*\{[^}]*border:\s*1px solid var\(--color-border-control\)/,
    );
    expect(style).toMatch(
      /#sort-switch:hover\s*\{[^}]*border-color:\s*var\(--color-border-control-hover\)/,
    );
  });

  test("the follow control renders with an accessible name when the open lane is alive, and is absent when it is not", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(aliveStatus);
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");

    // Wait for the follow control to be present when lane is alive
    await vi.waitFor(() => {
      const checkbox = doc.getElementById("log-follow");
      expect(checkbox).not.toBeNull();
    });

    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement | null;
    expect(followCheckbox?.getAttribute("id")).toBe("log-follow");

    const followLabel = doc.querySelector('label[for="log-follow"]');
    expect(followLabel).not.toBeNull();
    expect(followLabel?.textContent?.trim().toLowerCase()).toContain("follow");

    // Now emit a status where the lane is not alive
    const deadStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;
    page.source.emit("status", JSON.stringify(deadStatus));

    // Follow control should be removed when lane is not alive
    await vi.waitFor(() => {
      const checkbox = doc.getElementById("log-follow");
      expect(checkbox).toBeNull();
    });
  });

  test("with follow on, a refresh re-fetches that lane's log and leaves the body scrolled to the bottom", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(aliveStatus, "initial log");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
    });

    const logView = doc.getElementById("log") as HTMLElement | null;
    expect(logView).not.toBeNull();

    // Set up scrollHeight and clientHeight mocking
    let scrollTopValue = 0;
    Object.defineProperty(logView!, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logView!, "clientHeight", {
      get: () => 100,
      configurable: true,
    });
    Object.defineProperty(logView!, "scrollTop", {
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
      configurable: true,
    });

    // Check the follow checkbox
    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement | null;
    expect(followCheckbox).not.toBeNull();
    followCheckbox!.checked = true;
    const changeEvent = new (
      followCheckbox!.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    followCheckbox!.dispatchEvent(changeEvent);

    const fetchCountBefore = page.fetches.length;

    // Emit a new status to trigger a refresh
    page.source.emit("status", JSON.stringify(aliveStatus));

    // Wait for the refetch to happen and scrollTop to be updated
    await vi.waitFor(() => {
      expect(page.fetches.length).toBeGreaterThan(fetchCountBefore);
      expect(logView!.scrollTop).toBe(logView!.scrollHeight);
    });
  });

  test("with follow off, a refresh does not change the scroll position", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(aliveStatus, "initial log");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("log-pane") as HTMLElement | null)?.hidden,
      ).toBe(false);
    });

    const logView = doc.getElementById("log") as HTMLElement | null;
    expect(logView).not.toBeNull();

    // Set up scrollHeight and clientHeight mocking
    Object.defineProperty(logView!, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logView!, "clientHeight", {
      get: () => 100,
      configurable: true,
    });

    // Track scrollTop with a real backing variable, so a write during the
    // refresh actually shows up here instead of vanishing into a setter
    // that discards it.
    const savedScrollTop = 500;
    let scrollTopValue = savedScrollTop;
    Object.defineProperty(logView!, "scrollTop", {
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
      configurable: true,
    });

    const fetchCountBefore = page.fetches.length;

    // Do NOT check the follow checkbox (keep follow off)
    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement | null;
    expect(followCheckbox?.checked).toBe(false);

    // Emit a new status to trigger a refresh
    page.source.emit("status", JSON.stringify(aliveStatus));

    // Wait a moment for any async operations
    await new Promise((resolve) => setTimeout(resolve, 50));

    // With follow off, maybeFollow() must return before it ever fetches the
    // log tail or touches scrollTop: no new request, and the recorded
    // scrollTop write stays at its prior value.
    expect(page.fetches.length).toBe(fetchCountBefore);
    expect(logView!.scrollTop).toBe(savedScrollTop);
  });

  test("switching to a different alive lane leaves the reused follow control unticked", async () => {
    const twoLaneStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
            {
              wave: "T",
              lane: "t2",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(twoLaneStatus);
    const doc = page.window.document;
    const rows = doc.querySelectorAll("tr.lane");
    expect(rows.length).toBe(2);

    // Follow lane t1.
    press(rows[0]!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(doc.getElementById("log-follow")).not.toBeNull();
    });
    const followCheckboxT1 = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckboxT1.checked = true;
    followCheckboxT1.dispatchEvent(
      new (
        followCheckboxT1.ownerDocument!.defaultView as unknown as {
          Event: typeof Event;
        }
      ).Event("change", { bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(followCheckboxT1.checked).toBe(true);
    });

    // Open lane t2 — the follow control element is reused, not recreated,
    // since it already exists and t2 is alive too.
    press(rows[1]!.querySelector("button")!, "Enter");
    await vi.waitFor(() => {
      expect(doc.getElementById("log-lane")?.textContent).toBe("T/t2");
      expect(page.fetches).toContain("/api/log/T/t2?tail=16");
    });

    // The checkbox itself — not a closure variable the test cannot see —
    // must not still claim the view is live.
    const followCheckboxT2 = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    expect(followCheckboxT2).not.toBeNull();
    expect(followCheckboxT2.checked).toBe(false);

    // Confirm it behaviourally too: a status render for the new lane must
    // not start a follow refresh — if `following` were still true under
    // the hood, this would fetch again.
    const fetchCountBefore = page.fetches.length;
    page.source.emit("status", JSON.stringify(twoLaneStatus));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page.fetches.length).toBe(fetchCountBefore);
  });

  test("a follow refresh whose fetch rejects turns follow off, reports it, and leaves no unhandled rejection", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let calls = 0;
    const page = await loadPage(aliveStatus, () => {
      calls++;
      if (calls === 1) {
        return new Response("initial log", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return Promise.reject(new Error("network down"));
    });
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    // Wait for the open's own fetch (call #1) to land before starting
    // follow, so the follow refresh (call #2, the one that rejects) is
    // unambiguously the second call.
    await vi.waitFor(() => {
      expect(doc.getElementById("log-follow")).not.toBeNull();
      expect(doc.getElementById("log")?.textContent).toContain("initial log");
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const followCheckbox = doc.getElementById(
        "log-follow",
      ) as unknown as HTMLInputElement;
      followCheckbox.checked = true;
      followCheckbox.dispatchEvent(
        new (
          followCheckbox.ownerDocument!.defaultView as unknown as {
            Event: typeof Event;
          }
        ).Event("change", { bubbles: true }),
      );

      // The change handler's own follow refresh (call #2) is the one that
      // rejects. Follow must not remain silently on over that failure.
      await vi.waitFor(() => {
        expect(followCheckbox.checked).toBe(false);
      });
      expect(doc.getElementById("log-size")?.textContent).toMatch(
        /follow.*failed/i,
      );

      // Give any unhandled rejection a turn to surface before asserting
      // none did.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a follow refresh that resolves non-ok turns follow off and reports it, instead of leaving the box ticked over stale content", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let calls = 0;
    const page = await loadPage(aliveStatus, () => {
      calls++;
      if (calls === 1) {
        return new Response("initial log", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("server error", { status: 500 });
    });
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    // Wait for the open's own fetch (call #1) to land before starting
    // follow, so the follow refresh (call #2, the one that fails) is
    // unambiguously the second call and the race between the two
    // response chains cannot flip which content ends up on screen first.
    await vi.waitFor(() => {
      expect(doc.getElementById("log-follow")).not.toBeNull();
      expect(doc.getElementById("log")?.textContent).toContain("initial log");
    });

    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckbox.checked = true;
    followCheckbox.dispatchEvent(
      new (
        followCheckbox.ownerDocument!.defaultView as unknown as {
          Event: typeof Event;
        }
      ).Event("change", { bubbles: true }),
    );

    // The change handler's own follow refresh (call #2) is the one that
    // comes back non-ok. Follow must not remain silently on, ticked, over
    // a view that has stopped updating.
    await vi.waitFor(() => {
      expect(followCheckbox.checked).toBe(false);
    });
    expect(doc.getElementById("log-size")?.textContent).toMatch(
      /follow.*failed/i,
    );
    expect(doc.getElementById("log")?.textContent).toContain("initial log");
  });

  test("when the open lane's alive flips to false, follow turns off and the control disappears", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(aliveStatus, "initial log");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");

    // Wait for the follow control to appear
    await vi.waitFor(() => {
      const checkbox = doc.getElementById("log-follow");
      expect(checkbox).not.toBeNull();
    });

    // Check the follow checkbox
    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement | null;
    followCheckbox!.checked = true;
    const changeEvent = new (
      followCheckbox!.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    followCheckbox!.dispatchEvent(changeEvent);

    // Emit a status where the lane is no longer alive
    const deadStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;
    page.source.emit("status", JSON.stringify(deadStatus));

    // Wait for the control to disappear
    await vi.waitFor(() => {
      const checkbox = doc.getElementById("log-follow");
      expect(checkbox).toBeNull();
    });

    // Subsequent status updates should not try to fetch the log for a dead lane
    const fetchCountBefore = page.fetches.filter((url) =>
      url.includes("/api/log/"),
    ).length;
    page.source.emit("status", JSON.stringify(deadStatus));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const fetchCountAfter = page.fetches.filter((url) =>
      url.includes("/api/log/"),
    ).length;
    expect(fetchCountAfter).toBe(fetchCountBefore);
  });

  test("when follow is on and user scrolls away from the bottom, follow turns off automatically", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(aliveStatus, "initial log\nline 2\nline 3");
    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");

    // Wait for the follow control to appear
    await vi.waitFor(() => {
      const checkbox = doc.getElementById("log-follow");
      expect(checkbox).not.toBeNull();
    });

    const logView = doc.getElementById("log") as HTMLElement | null;
    expect(logView).not.toBeNull();

    // Set up scrollHeight and clientHeight mocking
    let scrollTopValue = 900;
    Object.defineProperty(logView!, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logView!, "clientHeight", {
      get: () => 100,
      configurable: true,
    });
    Object.defineProperty(logView!, "scrollTop", {
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
      configurable: true,
    });

    // Check the follow checkbox
    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement | null;
    expect(followCheckbox).not.toBeNull();
    followCheckbox!.checked = true;
    const changeEvent = new (
      followCheckbox!.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    followCheckbox!.dispatchEvent(changeEvent);
    expect(followCheckbox!.checked).toBe(true);

    // Simulate user scrolling away from the bottom
    scrollTopValue = 400;
    const scrollEvent = new (
      logView!.ownerDocument!.defaultView as unknown as { Event: typeof Event }
    ).Event("scroll", { bubbles: true });
    logView!.dispatchEvent(scrollEvent);

    // Check that follow turned off
    expect(followCheckbox!.checked).toBe(false);
  });

  test("two overlapping follow refreshes for the same lane: an older response resolving after a newer one is discarded", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let resolveOpen!: (res: Response) => void;
    const pOpen = new Promise<Response>((resolve) => {
      resolveOpen = resolve;
    });
    let resolveFirst!: (res: Response) => void;
    const pFirst = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond!: (res: Response) => void;
    const pSecond = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });

    let calls = 0;
    const page = await loadPage(aliveStatus, () => {
      calls++;
      if (calls === 1) return pOpen;
      if (calls === 2) return pFirst;
      return pSecond;
    });

    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    resolveOpen(new Response("initial", { status: 200 }));
    await vi.waitFor(() => {
      expect(doc.getElementById("log-follow")).not.toBeNull();
    });

    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckbox.checked = true;
    const changeEvent = new (
      followCheckbox.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    // Fires the first (older) follow refresh — pending on pFirst.
    followCheckbox.dispatchEvent(changeEvent);

    // A status render is the follow path's other trigger — fire a second
    // (newer) follow refresh before the first resolves, pending on pSecond.
    page.source.emit("status", JSON.stringify(aliveStatus));

    // Resolve the newer request first, then let the older one land after —
    // the older response must never overwrite the newer content.
    resolveSecond(new Response("second (newer) content", { status: 200 }));
    await vi.waitFor(() => {
      expect(doc.getElementById("log")?.textContent).toContain(
        "second (newer) content",
      );
    });

    resolveFirst(new Response("first (stale) content", { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(doc.getElementById("log")?.textContent).toContain(
      "second (newer) content",
    );
    expect(doc.getElementById("log")?.textContent).not.toContain(
      "first (stale) content",
    );
  });

  test("follow unchecked while a refresh is in flight: the response does not scroll the view", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let resolveOpen!: (res: Response) => void;
    const pOpen = new Promise<Response>((resolve) => {
      resolveOpen = resolve;
    });
    let resolveFollow!: (res: Response) => void;
    const pFollow = new Promise<Response>((resolve) => {
      resolveFollow = resolve;
    });

    let calls = 0;
    const page = await loadPage(aliveStatus, () => {
      calls++;
      return calls === 1 ? pOpen : pFollow;
    });

    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    resolveOpen(new Response("initial", { status: 200 }));
    await vi.waitFor(() => {
      expect(doc.getElementById("log-follow")).not.toBeNull();
    });

    const logView = doc.getElementById("log") as HTMLElement | null;
    expect(logView).not.toBeNull();
    const savedScrollTop = 500;
    let scrollTopValue = savedScrollTop;
    Object.defineProperty(logView!, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logView!, "clientHeight", {
      get: () => 100,
      configurable: true,
    });
    Object.defineProperty(logView!, "scrollTop", {
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
      configurable: true,
    });

    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckbox.checked = true;
    const check = new (
      followCheckbox.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    // Starts the follow refresh — pending on pFollow.
    followCheckbox.dispatchEvent(check);

    // Uncheck follow while that refresh is still in flight.
    followCheckbox.checked = false;
    const uncheck = new (
      followCheckbox.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    followCheckbox.dispatchEvent(uncheck);

    // Now let the in-flight refresh land.
    resolveFollow(new Response("late content", { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The content may still update, but nothing should have scrolled the
    // view — the user turned follow off before this response arrived.
    expect(logView!.scrollTop).toBe(savedScrollTop);
  });

  test("the user scrolls up while a refresh is in flight: the response does not scroll the view", async () => {
    const aliveStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    let resolveOpen!: (res: Response) => void;
    const pOpen = new Promise<Response>((resolve) => {
      resolveOpen = resolve;
    });
    let resolveFollow!: (res: Response) => void;
    const pFollow = new Promise<Response>((resolve) => {
      resolveFollow = resolve;
    });

    let calls = 0;
    const page = await loadPage(aliveStatus, () => {
      calls++;
      return calls === 1 ? pOpen : pFollow;
    });

    const doc = page.window.document;
    const row = doc.querySelector("tr.lane");
    press(row!.querySelector("button")!, "Enter");
    resolveOpen(new Response("initial", { status: 200 }));
    await vi.waitFor(() => {
      expect(doc.getElementById("log-follow")).not.toBeNull();
    });

    const logView = doc.getElementById("log") as HTMLElement | null;
    expect(logView).not.toBeNull();
    let scrollTopValue = 900;
    Object.defineProperty(logView!, "scrollHeight", {
      get: () => 1000,
      configurable: true,
    });
    Object.defineProperty(logView!, "clientHeight", {
      get: () => 100,
      configurable: true,
    });
    Object.defineProperty(logView!, "scrollTop", {
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
      configurable: true,
    });

    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckbox.checked = true;
    const check = new (
      followCheckbox.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("change", { bubbles: true });
    // Starts the follow refresh — pending on pFollow.
    followCheckbox.dispatchEvent(check);

    // The user scrolls up to read history while that refresh is in flight.
    scrollTopValue = 400;
    const scrollEvent = new (
      logView!.ownerDocument!.defaultView as unknown as {
        Event: typeof Event;
      }
    ).Event("scroll", { bubbles: true });
    logView!.dispatchEvent(scrollEvent);
    expect(followCheckbox.checked).toBe(false);

    // Now let the in-flight refresh land.
    resolveFollow(new Response("late content", { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The scroll position the user chose must not have been overwritten.
    expect(logView!.scrollTop).toBe(400);
  });

  test("each lane column carries its semantic class, matching the header's", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const columnClasses = [
      "c-state",
      "c-lane",
      "c-seat",
      "c-stage",
      "c-live",
      "c-log",
      "c-pr",
      "c-gate",
      "c-find",
    ];
    const headerCells = Array.from(doc.querySelectorAll("thead th"));
    expect(headerCells.map((th) => th.className)).toEqual(columnClasses);

    const row = doc.querySelector("tr.lane");
    expect(row).not.toBeNull();
    const cells = Array.from(row!.querySelectorAll("td"));
    expect(cells.map((td) => td.className)).toEqual(columnClasses);
  });

  test("the seat that ran a lane names it; a lane dispatched without one says unknown", async () => {
    const seatStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "named",
              seat: "kiln-go/quartz-2.7-lite",
              derived: { alive: false },
              disagreements: [],
            },
            {
              wave: "T",
              lane: "unnamed",
              derived: { alive: false },
              disagreements: [],
            },
            {
              wave: "T",
              lane: "hostile",
              seat: "<img src=x onerror=alert(1)>",
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(seatStatus);
    const doc = page.window.document;
    const seatOf = (lane: string): string =>
      doc
        .querySelector(`tr.lane[data-lane="${lane}"] td.c-seat`)
        ?.textContent?.trim() ?? "";

    expect(seatOf("named")).toBe("kiln-go/quartz-2.7-lite");
    // An absent record is the word unknown — never blank, never a guess.
    expect(seatOf("unnamed")).toBe("unknown");
    // The word is the cell's whole content: no span, no class a screen reader
    // would have to traverse, and no styling left carrying the meaning.
    const unnamedCell = doc.querySelector(
      'tr.lane[data-lane="unnamed"] td.c-seat',
    );
    expect(unnamedCell?.innerHTML).toBe("unknown");
    expect(unnamedCell?.querySelector("span")).toBeNull();
    // The seat is a value from disk, like every other cell: it renders as text.
    expect(seatOf("hostile")).toBe("<img src=x onerror=alert(1)>");
    const hostileCell = doc.querySelector(
      'tr.lane[data-lane="hostile"] td.c-seat',
    );
    expect(hostileCell?.querySelector("img")).toBeNull();
    expect(hostileCell?.innerHTML).toContain("&lt;img");
  });

  test("the seat header keeps its visible label inside an accessible name", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const th = doc.querySelector("thead th.c-seat");
    expect(th).not.toBeNull();
    expect(th!.textContent?.trim()).toBe("seat");
    // WCAG 2.5.3 (Label in Name): the accessible name contains the visible label.
    expect(th!.getAttribute("aria-label")).toBe(
      "seat (model that ran the lane)",
    );
    expect(th!.getAttribute("aria-label")).toContain(th!.textContent!.trim());
  });

  test("the derived state leads every lane row, as a word in a coloured pill with a dot", async () => {
    const page = await loadPage(stateFixture(Date.now()));
    const doc = page.window.document;
    for (const [laneId, state, tone] of EXPECTED_STATE_PILLS) {
      const row = doc.querySelector(`tr.lane[data-lane="${laneId}"]`);
      expect(row, `lane ${laneId} never rendered`).not.toBeNull();
      // Leading the row: the state is the first cell a reader meets, so the
      // verdict never depends on scanning the other six.
      const cell = row!.querySelector("td");
      expect(
        cell?.className,
        `lane ${laneId}'s first cell is not the state cell`,
      ).toBe("c-state");
      const pill = cell?.querySelector(".pill") as unknown as HTMLElement;
      expect(pill, `lane ${laneId} has no state pill`).toBeTruthy();
      expect(pill.textContent?.trim()).toBe(state);
      expect(pill.classList.contains(tone)).toBe(true);
      // Form as well as colour: every state pill carries its dot.
      expect(pill.querySelector(".pill-dot")).not.toBeNull();
    }
  });

  test("the state cell says exactly what laneState() says for the same lane", async () => {
    // The page holds its own copy of the derivation — the inline script cannot
    // import the module — so this test is the seam between them. It is driven
    // from the INPUT space, not from the list of states: every combination of
    // `pr.state` × `pr.checks` the types permit, plus the no-PR cases, each fed
    // to both implementations. A hand-listed set of outputs can only ever miss
    // an input that maps to no output — which is precisely the gap that let an
    // open PR with `checks: "none"` fall through to a throw on main while the
    // page rendered "unknown" for it. The types enumerate the space; the test
    // enumerates what the types enumerate. The state fixture rides along: the
    // inputs that make the PR arms decide (exit, log age, disagreement) belong
    // to the same seam, and dropping them would let a reordering of those arms
    // survive here.
    const now = Date.now();
    const lanes: Record<string, unknown>[] = [
      ...stateFixture(now).waves[0].lanes,
    ] as unknown as Record<string, unknown>[];
    const noPrCases: ReadonlyArray<
      readonly [string, Record<string, unknown>, Record<string, unknown>?]
    > = [
      ["no-pr", { alive: false }],
      ["no-pr-exit0", { alive: false, exit: 0 }],
      ["no-pr-fail", { alive: false, exit: 1 }],
      ["no-pr-alive", { alive: true }],
      // The no-PR branch's two arms: a start with nothing after it (the
      // module's `unknown`) and a start whose log ended without a PR (the
      // module's `vanished`). The no-report silence above pins the second
      // copy of the vanished default; these pin the split.
      [
        "no-pr-started",
        { alive: false },
        {
          stage: "implement",
          event: "started",
          ts: new Date(now).toISOString(),
        },
      ],
      [
        "no-pr-started-exit0",
        { alive: false, exit: 0 },
        { stage: "gate", event: "started", ts: new Date(now).toISOString() },
      ],
    ];
    for (const [id, derived, reported] of noPrCases) {
      lanes.push({
        wave: "S",
        lane: id,
        derived,
        disagreements: [],
        ...(reported === undefined ? {} : { reported }),
      });
    }
    // Derived from the declared union, not copied from it: a state or check
    // value added to `LaneObservation["pr"]` without being listed here fails to
    // compile (the `Record` is missing a key), and one listed that the types no
    // longer permit fails too (an excess property). The input space can then
    // only ever be as stale as the types themselves — a hand-listed set of
    // *states* is how the first version of this seam missed an input that
    // mapped to none of them.
    type PermittedPr = NonNullable<DerivedLane["pr"]>;
    const prStates = Object.keys({
      open: true,
      merged: true,
      closed: true,
    } satisfies Record<PermittedPr["state"], true>) as PermittedPr["state"][];
    const prChecks = Object.keys({
      none: true,
      pending: true,
      pass: true,
      fail: true,
      // \*Could not ask\* was added with the thread count. The enumeration is compile-pinned to
      // the union — a member added or removed on either side fails here.
      unknown: true,
    } satisfies Record<PermittedPr["checks"], true>) as PermittedPr["checks"][];
    // The thread axis is driven too: measured-zero, measured-positive,
    // explicitly-unmeasurable, and absent (a payload written before threads were counted). Absent must read
    // as unmeasured on an open PR, never as the silence of a clean row.
    const prThreads: ReadonlyArray<
      readonly [string, number | "unknown" | undefined]
    > = [
      ["absent", undefined],
      ["zero", 0],
      ["two", 2],
      ["unread", "unknown"],
    ];
    for (const state of prStates) {
      for (const checks of prChecks) {
        for (const [threadTag, threads] of prThreads) {
          lanes.push({
            wave: "S",
            lane: `pr-${state}-${checks}-${threadTag}`,
            derived: {
              alive: false,
              pr: {
                number: 9,
                state,
                checks,
                ...(threads === undefined
                  ? {}
                  : { unresolvedThreads: threads }),
              },
            },
            disagreements: [],
          });
        }
      }
    }
    const status = {
      generatedAt: new Date(now).toISOString(),
      waves: [{ id: "S", lanes }],
    } as unknown as WaveStatus;

    const page = await loadPage(status);
    const doc = page.window.document;
    expect(doc.querySelectorAll("tr.lane").length).toBe(lanes.length);
    for (const lane of lanes) {
      const id = lane.lane as string;
      const pill = doc.querySelector(
        `tr.lane[data-lane="${id}"] td.c-state .pill`,
      ) as unknown as HTMLElement | null;
      expect(pill, `lane ${id} has no state pill`).toBeTruthy();
      // A thrown exception is an answer the page can never give, and a
      // rendered word is one the module can never withhold: on this seam they
      // are a difference, not an exemption — so the module's verdict is
      // recorded in the same currency the row renders.
      let said: string;
      try {
        said = laneState(lane as unknown as LaneStatus, now);
      } catch (error) {
        said = `threw: ${String(error)}`;
      }
      expect(pill!.textContent?.trim(), `lane ${id}`).toBe(said);
    }
  });

  test("the rollup counts every lane exactly as its row leads, and both match the module", async () => {
    // The counts and the rows must come from ONE computation. This asserts the
    // three against each other on the *same* fixture the row pills are asserted
    // on — `stateFixture`, one lane per state — so a header number can never
    // drift from the rows under it, and neither can drift from `laneState`:
    //   (a) tally of the rendered row pills,
    //   (b) the wave band's `.wave-meta` counts,
    //   (c) the page-level `#state-summary` bar,
    //   (d) the module's `laneStateCounts`, which is `laneState` bucketed.
    // A wrong count is the more dangerous for agreeing with a wrong row, so the
    // module — the page cannot import it — is the tiebreaker on all three.
    const now = Date.now();
    const status = stateFixture(now);
    const lanes = status.waves[0].lanes as unknown as LaneStatus[];
    const moduleCounts = laneStateCounts(lanes, now);
    const present = (Object.entries(moduleCounts) as [string, number][]).filter(
      ([, n]) => n > 0,
    );

    const page = await loadPage(status);
    const doc = page.window.document;

    // (a) The rows: tally the word each lane's leading cell renders. Only the
    // states present produce a pill, so the tally matches the non-zero slice of
    // the module's counts exactly.
    const rowTally: Record<string, number> = {};
    for (const pill of doc.querySelectorAll("tr.lane td.c-state .pill")) {
      const word = pill.textContent?.trim() ?? "";
      rowTally[word] = (rowTally[word] ?? 0) + 1;
    }
    expect(rowTally).toEqual(Object.fromEntries(present));

    // (b) The wave band's per-wave counts, over the same lanes — asserted
    // exactly, not with `toContain`: "1 running" is a substring of "12 running",
    // so a loose assertion on a count passes on a wrong count, and a roll-up
    // whose numbers are merely plausible is not a roll-up. The expected string is
    // built from the module's counts in the module's `LANE_STATES` order, which
    // also pins the page's copy of that order to the module's.
    const meta =
      doc.querySelector('tr.wave[data-wave="S"] .wave-meta')?.textContent ?? "";
    expect(meta).toBe(
      [
        `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"}`,
        ...LANE_STATES.filter((s) => moduleCounts[s] > 0).map(
          (s) => `${moduleCounts[s]} ${s}`,
        ),
      ].join(" · "),
    );
    expect(present.length).toBeGreaterThan(0);

    // (c) The page-level summary bar: the needs-a-human lead and per-state chips.
    // The lead is pinned to the module's `laneNeedsHuman` — the lane-aware
    // predicate, not a state list copied into this file — the same reason the
    // row pill is pinned to `laneState`: the page holds a second copy of the
    // rule, and this is the seam between them. A thread-blocked lane must
    // raise the total exactly as a running one does; a CI-only block must not.
    const attention =
      doc.querySelector('#state-summary [data-state="attention"] .value')
        ?.textContent ?? "";
    const wantsHuman = lanes.filter((lane) => laneNeedsHuman(lane, now)).length;
    expect(Number(attention)).toBe(wantsHuman);
    // The lead only turns red when there is someone to call.
    expect(
      (
        doc.querySelector(
          '#state-summary [data-state="attention"] .value',
        ) as unknown as HTMLElement
      ).classList.contains("hot"),
    ).toBe(wantsHuman > 0);
    const chipText = [...doc.querySelectorAll("#state-summary .ss-chip")].map(
      (el) => el.textContent?.trim() ?? "",
    );
    expect(chipText.sort()).toEqual(
      present.map(([s, n]) => `${n} ${s}`).sort(),
    );

    // Explicitly: every past-wave lane in the
    // fixture keeps naming its earned state in the row — the rollup above
    // already counted them there, and each still carries its own
    // stale-evidence voice — but the module's `laneNeedsHuman` and the page's
    // attention lead (already asserted equal to `wantsHuman` above) must
    // agree on which of them still needs a human: the three carrying a fresh,
    // live-probed fact (alive, a currently-failing open PR, a currently
    // unresolved thread) do; the one with none, past a merged PR, does not.
    const pastLaneStates: ReadonlyArray<readonly [string, string, boolean]> = [
      ["past-failed", "failed", false],
      ["past-alive", "stalled", true],
      ["past-pr-failing", "failed", true],
      ["past-pr-blocked", "blocked", true],
    ];
    for (const [laneId, state, needsHuman] of pastLaneStates) {
      const pill = doc.querySelector(
        `tr.lane[data-lane="${laneId}"] td.c-state .pill`,
      );
      expect(pill?.textContent?.trim(), laneId).toBe(state);
      // The row keeps its own stale-evidence voice regardless — this lane
      // hides nothing, whether or not it still needs a human.
      expect(
        doc.querySelector(`tr.lane[data-lane="${laneId}"] td.c-state`)
          ?.textContent,
        laneId,
      ).toContain("stale evidence");
      const lane = lanes.find((l) => l.lane === laneId)!;
      expect(laneNeedsHuman(lane, now), laneId).toBe(needsHuman);
    }
  });

  test("hide inactive leaves exactly the lanes that need a human, and survives a reload", async () => {
    const now = Date.now();
    const status = stateFixture(now);
    const lanes = status.waves[0].lanes as unknown as LaneStatus[];
    // The set the toggle keeps, derived here from the module — `laneNeedsHuman`
    // over the lane — not copied from the page's inline list, so the test is
    // the seam and not an echo: a page that drops a state the module still keeps
    // (or the reverse) is caught here, exactly as a divergent word is caught by
    // the row-pill parity test.
    const activeIds = lanes
      .filter((lane) => laneNeedsHuman(lane, now))
      .map((lane) => lane.lane);
    const inactiveIds = lanes
      .map((lane) => lane.lane)
      .filter((id) => !activeIds.includes(id));
    expect(activeIds.length).toBeGreaterThan(0);
    expect(inactiveIds.length).toBeGreaterThan(0);
    // Explicitly: a past-wave lane with no fresh, live-probed fact falls
    // into the inactive set even though its state ("failed") would otherwise
    // need a human — but the three carrying one (alive, a currently-failing
    // open PR, a currently unresolved thread) stay active despite equally
    // stale evidence.
    expect(activeIds).not.toContain("past-failed");
    expect(inactiveIds).toContain("past-failed");
    for (const laneId of ["past-alive", "past-pr-failing", "past-pr-blocked"]) {
      expect(activeIds, laneId).toContain(laneId);
      expect(inactiveIds, laneId).not.toContain(laneId);
    }

    const page = await loadPage(status);
    const doc = page.window.document;
    const toggle = doc.getElementById(
      "hide-inactive",
    ) as unknown as HTMLElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-label")).toMatch(/inactive/i);
    // Off by default: everything is shown.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(doc.querySelectorAll("tr.lane").length).toBe(lanes.length);

    // Turn it on: only the needs-a-human lanes remain.
    toggle.click();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    const shown = [...doc.querySelectorAll('tr.lane[data-wave="S"]')].map(
      (row) => row.getAttribute("data-lane"),
    );
    expect(shown.sort()).toEqual([...activeIds].sort());
    for (const id of inactiveIds) {
      expect(doc.querySelector(`tr.lane[data-lane="${id}"]`)).toBeNull();
    }

    // The preference is written where the sort preference is written.
    expect(page.window.localStorage.getItem("wave-status:hide-inactive")).toBe(
      "true",
    );

    // Turn it back off: everything returns, and the choice is persisted false.
    toggle.click();
    expect(doc.querySelectorAll("tr.lane").length).toBe(lanes.length);
    expect(page.window.localStorage.getItem("wave-status:hide-inactive")).toBe(
      "false",
    );

    // A reload with the stored choice starts hidden, without a click.
    const reloaded = await loadPage(status, undefined, {
      storage: { "wave-status:hide-inactive": "true" },
    });
    const reloadedToggle = reloaded.window.document.getElementById(
      "hide-inactive",
    ) as unknown as HTMLElement;
    expect(reloadedToggle.getAttribute("aria-checked")).toBe("true");
    expect(
      [...reloaded.window.document.querySelectorAll('tr.lane[data-wave="S"]')]
        .map((row) => row.getAttribute("data-lane"))
        .sort(),
    ).toEqual([...activeIds].sort());

    // A wave whose every lane is inactive says so, rather than vanishing blank.
    // A live lane rides in a second wave so the page has a row to render at all
    // (loadPage waits for one) — the hidden wave is what this asserts.
    const allDone = {
      generatedAt: new Date(now).toISOString(),
      waves: [
        {
          id: "D",
          lanes: [
            {
              wave: "D",
              lane: "ready",
              derived: {
                alive: false,
                pr: {
                  number: 1,
                  state: "open",
                  checks: "pass",
                  unresolvedThreads: 0,
                },
              },
              disagreements: [],
            },
            {
              wave: "D",
              lane: "merged",
              derived: {
                alive: false,
                pr: { number: 2, state: "merged", checks: "pass" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "A",
          lanes: [
            {
              wave: "A",
              lane: "live",
              derived: { alive: true },
              disagreements: [],
            },
          ],
        },
      ],
    } as unknown as WaveStatus;
    const hiddenPage = await loadPage(allDone, undefined, {
      storage: { "wave-status:hide-inactive": "true" },
    });
    const hiddenDoc = hiddenPage.window.document;
    // Wave A's running lane survives; wave D's inactive lanes are all hidden.
    expect(hiddenDoc.querySelectorAll('tr.lane[data-wave="A"]').length).toBe(1);
    expect(hiddenDoc.querySelector('tr.lane[data-wave="D"]')).toBeNull();
    const empty = hiddenDoc.querySelector('tr.empty[data-wave="D"]');
    // The empty row names the control that emptied the wave, and how many rows it
    // took: "no lanes need a human" is the fact, "hide inactive is hiding 2 lanes"
    // is the remedy.
    expect(empty?.textContent).toBe(
      "No lanes need a human here — “hide inactive” is hiding 2 lanes",
    );
  });

  test("a wave emptied by hide inactive is never reported as a failed search", async () => {
    // The failure this whole redesign exists to remove: with both controls active
    // and a query that matches only lanes that do not need a human, the page used
    // to say "No lanes match" — a confidently wrong answer. The lane DID match;
    // the state control hid it. *Not found* and *hidden* are different facts, so
    // the empty row must say which control took the rows out, and the query must
    // still be blamed for the rows it really did remove.
    const bothControls = {
      generatedAt: new Date().toISOString(),
      waves: [
        {
          id: "V",
          lanes: [
            {
              wave: "V",
              lane: "v-live",
              derived: { alive: true },
              disagreements: [],
            },
            {
              wave: "V",
              lane: "v-ready",
              derived: {
                alive: false,
                pr: {
                  number: 20,
                  state: "open",
                  checks: "pass",
                  unresolvedThreads: 0,
                },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "W",
          lanes: [
            {
              wave: "W",
              lane: "w-merged",
              derived: {
                alive: false,
                pr: { number: 21, state: "merged", checks: "pass" },
              },
              disagreements: [],
            },
            {
              wave: "W",
              lane: "w-blocked",
              derived: {
                alive: false,
                pr: { number: 22, state: "open", checks: "pending" },
              },
              disagreements: [],
            },
          ],
        },
        { id: "X", lanes: [] },
      ],
    } as unknown as WaveStatus;

    const page = await loadPage(bothControls, undefined, {
      storage: { "wave-status:hide-inactive": "true" },
    });
    const doc = page.window.document;
    const filter = doc.getElementById("filter") as unknown as HTMLInputElement;
    const setInput = (value: string) => {
      filter.value = value;
      filter.dispatchEvent(
        new (doc.defaultView as unknown as { Event: typeof Event }).Event(
          "input",
          {
            bubbles: true,
          },
        ),
      );
    };

    // A query that matches only hidden lanes: hidden, not missing — and named
    // after the switch that hid them, in the plural form.
    setInput("w-");
    const hiddenW = doc.querySelector('tr.empty[data-wave="W"]');
    expect(hiddenW?.textContent).toBe(
      "2 lanes matching “w-” hidden by “hide inactive”",
    );
    // The same render, the other direction: wave V's rows really do not answer
    // the query, and that is what the row says. Two waves, two different answers,
    // because two different controls emptied them.
    const unmatchedV = doc.querySelector('tr.empty[data-wave="V"]');
    expect(unmatchedV?.textContent).toBe("No lanes match “w-”");

    // A wave with no lanes at all: nothing to match and nothing hidden. The query
    // must not be blamed for an empty wave either.
    expect(doc.querySelector('tr.empty[data-wave="X"]')?.textContent).toBe(
      "No lanes in wave",
    );

    // A singular match, and the query echoed back exactly as typed — the case the
    // reader searched for, in the reader's own spelling.
    setInput("V-Ready");
    expect(doc.querySelector('tr.empty[data-wave="V"]')?.textContent).toBe(
      "1 lane matching “V-Ready” hidden by “hide inactive”",
    );
    expect(doc.querySelector('tr.empty[data-wave="W"]')?.textContent).toBe(
      "No lanes match “V-Ready”",
    );

    // Clear the query and the switch is the only story left.
    setInput("");
    expect(doc.querySelector('tr.empty[data-wave="W"]')?.textContent).toBe(
      "No lanes need a human here — “hide inactive” is hiding 2 lanes",
    );
    // Wave V still carries its running lane and its hidden ready lane: the row
    // count on the band is the visible set, and the empty row is nowhere.
    expect(doc.querySelectorAll('tr.lane[data-wave="V"]').length).toBe(1);
    expect(doc.querySelector('tr.empty[data-wave="V"]')).toBeNull();
    expect(doc.querySelectorAll('tr.empty[data-wave="X"]').length).toBe(1);
  });

  test("every caller of the page's clock-taking helpers hands over a clock", async () => {
    // None of these takes a default, and none can: a `nowMs` that defaults to
    // `Date.now()` lets the row, its header and the summary bar read three
    // different instants, which is the drift the single clock in `render` exists
    // to remove — and an omitted clock fails silently, because `mtimeMs < NaN` is
    // simply false, so a stalled lane would render as `running` and be counted as
    // `running` by a header reading a fourth clock. The page defines no globals,
    // so no caller outside this file can omit it; this pins the call sites in the
    // file itself.
    const html = await readFile(PAGE_PATH, "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const clockTaking = [
      "stateCell",
      "waveMeta",
      "renderSummaryBar",
      "laneHiddenByInactive",
      "isLaneActive",
      "laneStateCountsOf",
      "laneStateOf",
    ];
    let occurrences = 0;
    for (const name of clockTaking) {
      for (const call of script.matchAll(
        new RegExp(`${name}\\(([^)]*)\\)`, "g"),
      )) {
        occurrences++;
        expect(
          call[1],
          `${name} must be called with a clock, not a defaulted one`,
        ).toMatch(/\bnowMs\b/);
      }
    }
    // Each name appears at least as a definition and a call: a helper nobody
    // calls is not a seam, and this test would then pass on an empty sweep.
    expect(occurrences).toBeGreaterThanOrEqual(clockTaking.length * 2);
  });

  test("a localStorage read that throws leaves hide-inactive off, not stuck on", async () => {
    // The same resilience the sort preference has: an unreadable store is a page
    // that was never told, which is the honest default — show everything.
    const page = await loadPage(stateFixture(Date.now()), undefined, {
      mockStorageError: true,
    });
    const toggle = page.window.document.getElementById(
      "hide-inactive",
    ) as unknown as HTMLElement;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // One lane per state the derivation can name, plus the three thread lanes
    // (a measured thread blocker, a checks read that could not be taken, and
    // an unreadable thread state) and the four past-wave lanes.
    expect(page.window.document.querySelectorAll("tr.lane").length).toBe(18);
  });

  test("a lane whose PR state the derivation cannot name renders as unknown, not as a guess", async () => {
    // The collector does produce `closed` PRs (collect.ts keeps open/merged/
    // closed), and the ranking has no verdict for one — the lane's PR was shut
    // without merging, which is neither ready nor merged nor failed. Both
    // implementations must say the gap plainly: an unnamed state is a question,
    // a wrong state is a lie. It used to be that the module threw here and only
    // the page could answer; a throw on this seam is exactly the divergence the
    // parity test above exists to keep out.
    const now = Date.now();
    const closedStatus = {
      generatedAt: new Date(now).toISOString(),
      waves: [
        {
          id: "S",
          lanes: [
            ...stateFixture(now).waves[0].lanes,
            {
              wave: "S",
              lane: "closed",
              derived: {
                alive: false,
                pr: { number: 8, state: "closed", checks: "none" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as unknown as WaveStatus;
    const page = await loadPage(closedStatus);
    const doc = page.window.document;
    const pill = doc.querySelector(
      'tr.lane[data-lane="closed"] td.c-state .pill',
    ) as unknown as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent?.trim()).toBe("unknown");
    expect(pill.classList.contains("dim")).toBe(true);
    // The module answers in the same word — and nothing about the row's
    // oddity takes the rest of the table down.
    expect(laneState(closedStatus.waves[0].lanes[18], now)).toBe("unknown");
    expect(doc.querySelectorAll("tr.lane").length).toBe(19);
  });

  test("the page mirrors the exported stall threshold, to the millisecond", async () => {
    // The inline script cannot import the module, so it carries its own copy of
    // the constant — and this is what stops the two from drifting: the page's
    // literal, read from its own source, must equal `stallThresholdMs`. The
    // behavioural parity test above only pins it to within the fixture's
    // margins; this one pins the number.
    const html = await readFile(PAGE_PATH, "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const literal = /const STALL_THRESHOLD_MS = (\d+);/.exec(script);
    expect(
      literal,
      "the page no longer states its stall threshold",
    ).not.toBeNull();
    expect(Number(literal![1])).toBe(stallThresholdMs);
  });

  test("a running lane states how long it has been quiet, from the log's mtime", async () => {
    const page = await loadPage(stateFixture(Date.now()));
    const doc = page.window.document;
    expect(
      (
        doc.querySelector(
          'tr.lane[data-lane="running"] td.c-state',
        ) as unknown as HTMLElement
      ).textContent,
    ).toContain("quiet 4m");
    expect(
      (
        doc.querySelector(
          'tr.lane[data-lane="patient"] td.c-state',
        ) as unknown as HTMLElement
      ).textContent,
    ).toContain(
      `quiet ${Math.floor((stallThresholdMs - 5 * 60_000) / 60_000)}m`,
    );
    // Nothing to be quiet about: a lane with no log gets no invented number,
    // and the quiet time belongs to the living states only.
    const noLog = doc.querySelector(
      'tr.lane[data-lane="no-log"] td.c-state',
    ) as unknown as HTMLElement;
    expect(noLog.textContent).not.toContain("quiet");
    for (const laneId of [
      "stalled",
      "blocked",
      "ready",
      "merged",
      "vanished",
      "failed",
      "conflict",
    ]) {
      const cell = doc.querySelector(
        `tr.lane[data-lane="${laneId}"] td.c-state`,
      ) as unknown as HTMLElement;
      expect(cell.textContent, `lane ${laneId}`).not.toContain("quiet");
    }
  });

  // A page that cries wolf trains its reader to ignore it. These tests
  // pin the page's own faces of the truthfulness rule: silence after a
  // start is a question (unknown), not an accusation (vanished); the row
  // says why; days-old evidence ages the row and the header out of the live
  // register — the header's age even when the wave holds no log at all; and
  // a lane's own age never speaks as the wave's verdict.
  test("a started lane with nothing after it renders unknown, not vanished, and the row says why", async () => {
    const now = Date.now();
    const silentStatus = {
      generatedAt: new Date(now).toISOString(),
      waves: [
        {
          id: "S1",
          lanes: [
            {
              wave: "S1",
              lane: "quiet-start",
              reported: {
                stage: "implement",
                event: "started",
                ts: new Date(now - 60_000).toISOString(),
              },
              derived: { alive: false },
              disagreements: [],
            },
            {
              wave: "S1",
              lane: "ended-nothing",
              derived: { alive: false, exit: 0 },
              disagreements: [],
            },
          ],
        },
      ],
    } as unknown as WaveStatus;
    const page = await loadPage(silentStatus);
    const doc = page.window.document;
    const pillOf = (lane: string) =>
      doc
        .querySelector(`tr.lane[data-lane="${lane}"] td.c-state .pill`)
        ?.textContent?.trim();
    expect(pillOf("quiet-start")).toBe("unknown");
    // The module answers the same word for the same lane — the seam holds.
    const lanes = silentStatus.waves[0].lanes as unknown as LaneStatus[];
    expect(laneState(lanes[0], now)).toBe("unknown");
    // The ended run that produced no PR keeps the bad word: `vanished` must
    // still mean something vanished, not merely that nobody reported.
    expect(pillOf("ended-nothing")).toBe("vanished");
    // The reason travels in the row, beside the state word.
    const cell = doc.querySelector(
      'tr.lane[data-lane="quiet-start"] td.c-state',
    );
    expect(cell?.textContent).toContain("nothing since");
  });

  test("days-old evidence reads as stale in the row and past in the header, from an event alone where no log exists", async () => {
    const now = Date.now();
    const oldMs = now - 3 * 86_400_000;
    const pastStatus = {
      generatedAt: new Date(now).toISOString(),
      waves: [
        {
          id: "LIVE",
          lanes: [
            {
              wave: "LIVE",
              lane: "t1",
              derived: {
                alive: false,
                log: { bytes: 8, mtimeMs: now - 30_000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          id: "OLD",
          lanes: [
            {
              wave: "OLD",
              lane: "o1",
              derived: {
                alive: false,
                log: { bytes: 8, mtimeMs: oldMs, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
        {
          // Event-only: this wave holds no log files at all, so its header
          // age can only ever come from an event timestamp. Sharing a wave
          // with a logged lane — as an earlier cut of this fixture did —
          // let the other lane's log date the header and made the event
          // assertion here undetectable.
          id: "EV",
          lanes: [
            {
              wave: "EV",
              lane: "o2",
              reported: {
                stage: "implement",
                event: "started",
                ts: new Date(oldMs).toISOString(),
              },
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as unknown as WaveStatus;
    const page = await loadPage(pastStatus);
    const doc = page.window.document;

    for (const waveId of ["OLD", "EV"]) {
      const age = doc.querySelector(
        `tr.wave[data-wave="${waveId}"] .wave-age`,
      ) as unknown as HTMLElement;
      expect(age.textContent, `wave ${waveId}`).toBe("3d ago");
      expect(age.classList.contains("past"), `wave ${waveId}`).toBe(true);
    }
    const liveAge = doc.querySelector(
      'tr.wave[data-wave="LIVE"] .wave-age',
    ) as unknown as HTMLElement;
    expect(liveAge.textContent).toBe("now");
    expect(liveAge.classList.contains("past")).toBe(false);

    for (const lane of ["o1", "o2"]) {
      const cell = doc.querySelector(
        `tr.lane[data-lane="${lane}"] td.c-state`,
      ) as unknown as HTMLElement;
      expect(cell.textContent, `lane ${lane}`).toContain("stale evidence");
    }
    const liveCell = doc.querySelector(
      'tr.lane[data-lane="t1"] td.c-state',
    ) as unknown as HTMLElement;
    expect(liveCell.textContent).not.toContain("stale evidence");
  });

  test("a mixed-age wave stays live in the header while its stale row names itself stale, never a past wave", async () => {
    // The contradiction this pins: a wave holding one recent lane and one
    // lane older than the threshold classifies as *not* past at the wave
    // level (its newest evidence is minutes old) while the old lane's own
    // evidence is days past. A row that printed "past wave" there made two
    // statements about the same wave, disagreeing on screen. The row's note
    // describes the lane's stale evidence; the header alone owns the words
    // "past wave".
    const now = Date.now();
    const mixedStatus = {
      generatedAt: new Date(now).toISOString(),
      waves: [
        {
          id: "MIX",
          lanes: [
            {
              wave: "MIX",
              lane: "m1",
              derived: {
                alive: true,
                log: { bytes: 8, mtimeMs: now - 30_000, tail: "" },
              },
              disagreements: [],
            },
            {
              wave: "MIX",
              lane: "m2",
              derived: {
                alive: false,
                log: { bytes: 8, mtimeMs: now - 2 * 86_400_000, tail: "" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as unknown as WaveStatus;
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;

    const age = doc.querySelector(
      'tr.wave[data-wave="MIX"] .wave-age',
    ) as unknown as HTMLElement;
    expect(age.textContent).toBe("now");
    expect(age.classList.contains("past")).toBe(false);

    const staleRow = doc.querySelector(
      'tr.lane[data-lane="m2"] td.c-state',
    ) as unknown as HTMLElement;
    expect(staleRow.textContent).toContain("stale evidence");
    expect(staleRow.textContent).not.toContain("past wave");
    const freshRow = doc.querySelector(
      'tr.lane[data-lane="m1"] td.c-state',
    ) as unknown as HTMLElement;
    expect(freshRow.textContent).not.toContain("stale evidence");
    expect(freshRow.textContent).not.toContain("past wave");
  });

  test("the page mirrors the exported past-wave threshold, to the millisecond", async () => {
    // Same seam as the stall-threshold pin: the inline script carries its own
    // copy of the constant because it cannot import the module, and this is
    // what stops the two from drifting.
    const html = await readFile(PAGE_PATH, "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const literal = /const PAST_WAVE_THRESHOLD_MS = (\d+);/.exec(script);
    expect(
      literal,
      "the page no longer states its past-wave threshold",
    ).not.toBeNull();
    expect(Number(literal![1])).toBe(pastWaveThresholdMs);
  });

  test("the state cell keeps the lane's own identity in the next cell, so a verdict never replaces a name", async () => {
    const page = await loadPage(stateFixture(Date.now()));
    const doc = page.window.document;
    const row = doc.querySelector('tr.lane[data-lane="ready"]');
    const cells = Array.from(row!.querySelectorAll("td"));
    expect(cells[1]?.className).toBe("c-lane");
    expect(cells[1]?.textContent?.trim()).toBe("S/ready");
  });

  test("a pill renders per state with the right variant, and its accessible text is the state — not colour alone", async () => {
    // One lane per pill tone this table can show: stage (info/bad/ok as a
    // dotted pill) and PR checks (dim/warn/ok/bad) — five distinct tones
    // across the two families, each carrying its state as plain text.
    const pillStatus: WaveStatus = {
      generatedAt: "now",
      waves: [
        {
          id: "P",
          lanes: [
            {
              wave: "P",
              lane: "p1",
              reported: { stage: "review", event: "started", ts: "now" },
              derived: {
                alive: true,
                pr: { number: 1, state: "open", checks: "pending" },
              },
              disagreements: [],
            },
            {
              wave: "P",
              lane: "p2",
              reported: { stage: "gate", event: "failed", ts: "now" },
              derived: {
                alive: false,
                pr: { number: 2, state: "open", checks: "fail" },
              },
              disagreements: [],
            },
            {
              wave: "P",
              lane: "p3",
              reported: { stage: "remediate", event: "settled", ts: "now" },
              derived: {
                alive: false,
                pr: { number: 3, state: "merged", checks: "pass" },
              },
              disagreements: [],
            },
            {
              wave: "P",
              lane: "p4",
              derived: {
                alive: false,
                pr: { number: 4, state: "merged", checks: "none" },
              },
              disagreements: [],
            },
            {
              wave: "P",
              lane: "p5",
              reported: {
                stage: "dispatch",
                event: "started",
                ts: new Date(Date.now() - 120_000).toISOString(),
              },
              derived: {
                alive: false,
              },
              disagreements: [],
            },
            {
              wave: "P",
              lane: "p6",
              derived: {
                alive: true,
                pr: { number: 6, state: "open", checks: "unknown" },
              },
              disagreements: [],
            },
            {
              wave: "P",
              lane: "p7",
              derived: {
                alive: false,
                pr: {
                  number: 7,
                  state: "open",
                  checks: "pass",
                  unresolvedThreads: 2,
                },
              },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(pillStatus);
    const doc = page.window.document;
    const pills = Array.from(doc.querySelectorAll(".pill"));
    expect(pills.length).toBeGreaterThan(0);
    const byText = new Map(pills.map((el) => [el.textContent?.trim(), el]));

    const expectTone = (text: string, tone: string) => {
      const el = byText.get(text);
      expect(el, `no pill with text "${text}"`).toBeDefined();
      expect(el!.classList.contains("pill")).toBe(true);
      expect(el!.classList.contains(tone)).toBe(true);
    };

    expectTone("started", "info");
    expectTone("failed", "bad");
    expectTone("settled", "ok");
    expectTone("stalled", "warn");
    expectTone("pending", "warn");
    expectTone("none", "dim");
    // The two thread renderings, each distinct from every value that existed
    // before. *Could not ask* is warn — it wants a look — and *nothing to ask
    // about* keeps its dim `none`; a thread count is a word, not prose.
    expectTone("unknown", "warn");
    expectTone("threads:?", "warn");
    expectTone("threads:2", "warn");
    // Counts and states only: nothing in the rendered thread cell can carry
    // review prose, because the observation itself carries no prose to render.
    const p7pr = doc.querySelector('tr.lane[data-lane="p7"] td.c-pr');
    expect(p7pr?.textContent).toContain("threads:2");
    expect(p7pr?.textContent).not.toMatch(/[A-Za-z]{20,}/);

    // Every pill's accessible name is the state word itself, never colour
    // alone.
    for (const el of pills) {
      expect(el.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  test("the pre-PR-review gate flag renders as a bad-toned pill in the PR cell, for an open high-risk PR only", async () => {
    const riskStatus: WaveStatus = {
      generatedAt: new Date().toISOString(),
      waves: [
        {
          id: "R",
          lanes: [
            {
              wave: "R",
              lane: "pz1",
              derived: {
                alive: false,
                pr: { number: 43, state: "open", checks: "pending" },
                risk: "high-risk PR open without pre-PR review",
              },
              disagreements: [],
            },
            {
              wave: "R",
              lane: "pz4",
              derived: {
                alive: false,
                pr: { number: 44, state: "open", checks: "pass" },
              },
              disagreements: [],
            },
          ],
        },
      ],
    };

    const page = await loadPage(riskStatus);
    const doc = page.window.document;

    const flaggedRow = doc.querySelector(
      'tr.lane[data-wave="R"][data-lane="pz1"] td.c-pr',
    );
    expect(flaggedRow).not.toBeNull();
    expect(flaggedRow!.textContent).toContain(
      "high-risk PR open without pre-PR review",
    );
    const flaggedPill = Array.from(flaggedRow!.querySelectorAll(".pill")).find(
      (el) =>
        el.textContent?.trim() === "high-risk PR open without pre-PR review",
    );
    expect(flaggedPill).toBeDefined();
    expect(flaggedPill!.classList.contains("bad")).toBe(true);

    // A lane the collector never flagged (no `derived.risk`) gets no such pill,
    // whatever its own PR state is — the page never invents the verdict.
    const unflaggedRow = doc.querySelector(
      'tr.lane[data-wave="R"][data-lane="pz4"] td.c-pr',
    );
    expect(unflaggedRow).not.toBeNull();
    expect(unflaggedRow!.textContent).not.toContain(
      "high-risk PR open without pre-PR review",
    );
  });

  test("a lane with no live process and no terminal event absent beyond grace period renders as stalled, not running", async () => {
    const stalledStatus: WaveStatus = {
      generatedAt: new Date().toISOString(),
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              reported: {
                stage: "dispatch",
                event: "started",
                ts: new Date(Date.now() - 120_000).toISOString(),
              },
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(stalledStatus);
    const doc = page.window.document;

    const stagePill = doc.querySelector("tr.lane td.c-stage .pill");
    expect(stagePill).not.toBeNull();
    expect(stagePill!.textContent?.trim()).toBe("stalled");
    expect(stagePill!.classList.contains("warn")).toBe(true);

    // The wave band now rolls up the *derived state* the leading cell renders,
    // not the reported event the stage cell shows. This lane is `alive: false`
    // with no PR and no exit — and its last words were `started`, so the rule says
    // `unknown`, not `vanished`: silence after a start is a missing
    // measurement, not an accusation. The stage column still says `stalled`
    // (its own reported-vs-grace logic). A header that counted reported
    // events would read "1 stalled" over a row that says "unknown" — the
    // disagreement this lane exists to remove. What the test owns is the
    // agreement between header and row; the word is the module's.
    const meta = doc.querySelector(".wave-meta")?.textContent ?? "";
    expect(meta).toBe("1 lane · 1 unknown");
    expect(meta).not.toContain("running");
  });

  test("a lane that has just emitted started and is not yet visible to pgrep does not read as stalled", async () => {
    const justLaunchedStatus: WaveStatus = {
      generatedAt: new Date().toISOString(),
      waves: [
        {
          id: "T",
          lanes: [
            {
              wave: "T",
              lane: "t1",
              reported: {
                stage: "dispatch",
                event: "started",
                ts: new Date().toISOString(),
              },
              derived: { alive: false },
              disagreements: [],
            },
          ],
        },
      ],
    } as WaveStatus;

    const page = await loadPage(justLaunchedStatus);
    const doc = page.window.document;

    const stagePill = doc.querySelector("tr.lane td.c-stage .pill");
    expect(stagePill).not.toBeNull();
    expect(stagePill!.textContent?.trim()).toBe("started");
    expect(stagePill!.classList.contains("info")).toBe(true);
    expect(stagePill!.classList.contains("warn")).toBe(false);

    // The stage column reads `started` (within the launch grace), which is the
    // point of this lane. The band rolls up the derived state, and this lane is
    // `alive: false` with nothing else to say for it — the unknown of a start
    // with no verdict after it — so the header agrees with the row it sits
    // over rather than with the reported event the stage cell shows.
    const meta = doc.querySelector(".wave-meta")?.textContent ?? "";
    expect(meta).toBe("1 lane · 1 unknown");
    expect(meta).not.toContain("stalled");
  });

  test("an event emitted standalone by the orchestrator is read back correctly by the page", async () => {
    const root = mkdtempSync(join(tmpdir(), "wave-page-standalone-"));
    dirs.push(root);
    execFileSync("git", ["init", "--quiet", root]);
    // A config that NAMES the repository. Without one the writer asks the
    // machine's own `gh` which repository this is, so the case would depend on
    // whatever that machine is logged in to; with one it never reaches `gh`.
    mkdirSync(join(root, ".agents", "orchestration"), { recursive: true });
    writeFileSync(
      join(root, ".agents", "orchestration", "config.yaml"),
      "repo: acme/demo\n",
    );

    // An existing non-wave directory matching the wave token must not trap emission
    mkdirSync(join(root, "landing-pages-w06"), { recursive: true });

    // The built event writer, run against a temp log root. The source drove one
    // shell script; this is the same contract behind the bin the package ships.
    emit(root, "landing-pages-w06", "s1", "dispatch", "started", {
      detail: JSON.stringify({ seat: "anvil-orbit-4.2-flash-max" }),
    });
    emit(root, "landing-pages-w06", "s1", "implement", "settled", {
      pr: "342",
      round: "1",
      detail: JSON.stringify({ fixed: 3, refuted: 1, mutations: 2 }),
    });

    const waveDir = join(root, "wave-landing-pages-w06");
    expect(existsSync(join(waveDir, "events.jsonl"))).toBe(true);
    const { events } = readEvents(
      readFileSync(join(waveDir, "events.jsonl"), "utf8"),
    );
    expect(events.length).toBe(2);
    expect(events[0]?.wave).toBe("landing-pages-w06");
    expect(events[0]?.stage).toBe("dispatch");
    expect(events[0]?.event).toBe("started");
    expect(events[1]?.stage).toBe("implement");
    expect(events[1]?.event).toBe("settled");
    expect(events[1]?.pr).toBe(342);

    writeFileSync(join(waveDir, "s1.log"), "done\nEXIT 0\n");

    const status = await collect(
      fixtureDeps({
        gh: async () =>
          JSON.stringify([
            {
              number: 342,
              state: "OPEN",
              headRefName: "feat/s1",
              headRefOid: "abc",
            },
          ]),
      }),
      root,
      new Date().toISOString(),
    );
    const page = await loadPage(status);
    const doc = page.window.document;

    const row = doc.querySelector(
      'tr.lane[data-wave="landing-pages-w06"][data-lane="s1"]',
    );
    expect(row).not.toBeNull();

    const stageCell = row!.querySelector("td.c-stage");
    expect(stageCell).not.toBeNull();
    expect(stageCell!.textContent).toContain("settled");

    const stagePill = stageCell!.querySelector(".pill");
    expect(stagePill).not.toBeNull();
    expect(stagePill!.textContent?.trim()).toBe("settled");
    expect(stagePill!.classList.contains("ok")).toBe(true);

    const logCell = row!.querySelector("td.c-log");
    expect(logCell).not.toBeNull();
    expect(logCell!.textContent).toContain("EXIT 0");

    const prCell = row!.querySelector("td.c-pr");
    expect(prCell).not.toBeNull();
    expect(prCell!.textContent).toContain("#342");

    const findingsCell = row!.querySelector("td.c-find");
    expect(findingsCell).not.toBeNull();
    expect(findingsCell!.textContent).toContain("3 / 1 / 2");

    // The seat was recorded on the dispatch line; the implement-settled line
    // that overwrote `reported` did not carry it, yet the row still names it.
    const seatCell = row!.querySelector("td.c-seat");
    expect(seatCell).not.toBeNull();
    expect(seatCell!.textContent?.trim()).toBe("anvil-orbit-4.2-flash-max");
  });

  test("a corpus that was not read whole never renders as no PR", async () => {
    // "no PR" is a claim about the repository. Rows that came back and could
    // not be parsed make it a claim about the read, so the cell says which —
    // one malformed row must never again empty the whole corpus into a column
    // of "no PR".
    const whole = await loadPage(statusAt());
    expect(
      whole.window.document.querySelector("tr.lane td.c-pr")?.textContent,
    ).toBe("no PR");

    const gapped = await loadPage({ ...statusAt(), prs: { skipped: 2 } });
    const cell = gapped.window.document.querySelector("tr.lane td.c-pr");
    expect(cell?.textContent).toBe("no PR read");
    expect(cell?.querySelector("span")?.getAttribute("title")).toBe(
      "2 PR row(s) could not be read",
    );
  });

  test("the gap names the short read only where no PR joined; a joined PR still renders", async () => {
    const page = await loadPage({ ...mixedStatus, prs: { skipped: 1 } });
    const doc = page.window.document;
    const prOf = (lane: string) =>
      doc.querySelector(`tr.lane[data-lane="${lane}"] td.c-pr`)?.textContent ??
      "";
    // t1 and t2 joined PRs — the gap says nothing about them.
    expect(prOf("t1")).toContain("#1");
    expect(prOf("t2")).toContain("#2");
    // t3 joined nothing, and the corpus has a hole: not "no PR".
    expect(prOf("t3")).toBe("no PR read");
  });

  test("the wave band exposes eyebrow, id and a derived-state rollup inside the accordion button, and aria-controls resolves to that wave's own lane rows", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const waveT = doc.querySelector(
      'tr.wave[data-wave="T"]',
    ) as unknown as HTMLElement;
    const button = waveT.querySelector("button.wave-band");
    expect(button).not.toBeNull();
    expect(button!.querySelector(".wave-eyebrow")?.textContent).toBe("wave");
    expect(button!.querySelector(".wave-id")?.textContent).toBe("T");
    // The rollup is the derived state, counted the way the rows lead with it, and
    // asserted exactly: "2 running" would also be satisfied by a roll-up that
    // printed "12 running", which is the one thing a count must never be. Wave T
    // is t1 running, t2 failed, t3 running, t4 merged. It is NOT the reported
    // events (which would say one settled), and that is the whole point: the
    // header agrees with the rows.
    const meta = button!.querySelector(".wave-meta")?.textContent ?? "";
    expect(meta).toBe("4 lanes · 1 failed · 2 running · 1 merged");

    const controlsId = button!.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const target = doc.getElementById(controlsId!);
    expect(target).not.toBeNull();
    expect(target!.tagName).toBe("TBODY");
    expect(target!.querySelectorAll('tr.lane[data-wave="T"]').length).toBe(4);

    // Still a real accordion button: collapses and expands.
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    waveT.click();
    expect(button!.getAttribute("aria-expanded")).toBe("true");
    for (const lane of doc.querySelectorAll('tr.lane[data-wave="T"]')) {
      expect((lane as unknown as HTMLElement).hidden).toBe(false);
    }
    waveT.click();
    expect(button!.getAttribute("aria-expanded")).toBe("false");
  });

  test("the open lane's row carries .selected, survives a re-render, and clears on close", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    (
      doc.querySelector('tr.wave[data-wave="T"]') as unknown as HTMLElement
    ).click();

    const row = doc.querySelector(
      'tr.lane[data-wave="T"][data-lane="t1"]',
    ) as unknown as HTMLElement;
    row.click();
    await vi.waitFor(() => {
      expect(page.fetches).toContain("/api/log/T/t1?tail=16");
    });
    expect(row.classList.contains("selected")).toBe(true);
    // `.active` is retired, and not merely as a synonym: a class named *active*
    // on exactly one row is read as "this is the live lane", which is a lie
    // whenever the open log belongs to a lane that stopped an hour ago. The
    // page now has a true liveness column, so the false one must be gone
    // everywhere — in the markup and in the stylesheet.
    expect(doc.querySelectorAll(".active").length).toBe(0);
    expect(row.classList.contains("active")).toBe(false);
    // A different lane in the same wave never carries it.
    const other = doc.querySelector(
      'tr.lane[data-wave="T"][data-lane="t2"]',
    ) as unknown as HTMLElement;
    expect(other.classList.contains("selected")).toBe(false);

    page.source.emit("status", JSON.stringify(mixedStatus));
    const reRendered = doc.querySelector(
      'tr.lane[data-wave="T"][data-lane="t1"]',
    ) as unknown as HTMLElement;
    expect(reRendered).not.toBe(row);
    expect(reRendered.classList.contains("selected")).toBe(true);

    (doc.getElementById("log-close") as unknown as HTMLElement).click();
    const afterClose = doc.querySelector(
      'tr.lane[data-wave="T"][data-lane="t1"]',
    ) as unknown as HTMLElement;
    expect(afterClose.classList.contains("selected")).toBe(false);
  });

  test("the stylesheet highlights the selected row and defines no .active rule at all", async () => {
    const style = await pageStyle();
    expect(style).toContain("tr.lane.selected td");
    expect(style).not.toMatch(/tr\.lane\.active\b/);
    expect(style).not.toMatch(/\.active\b/);
  });

  test("with no waves at all, the table shows a single empty row instead of nothing", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    expect(doc.querySelectorAll("tr.wave").length).toBeGreaterThan(0);

    page.source.emit(
      "status",
      JSON.stringify({ generatedAt: "now", waves: [] }),
    );

    expect(doc.querySelectorAll("tr.wave").length).toBe(0);
    expect(doc.querySelectorAll("tr.lane").length).toBe(0);
    const emptyRows = doc.querySelectorAll("tr.empty");
    expect(emptyRows.length).toBe(1);
    expect(emptyRows[0]?.textContent).toMatch(/no waves/i);
  });

  test("every semantic column keeps its header treatment distinct from its own body cells", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    (
      doc.querySelector('tr.wave[data-wave="T"]') as unknown as HTMLElement
    ).click();

    const bodyRow = doc.querySelector('tr.lane[data-wave="T"][data-lane="t1"]');
    expect(bodyRow).not.toBeNull();

    // All nine semantic column classes the header and body share — a
    // body-cell rule scoped only to its own class (no tbody/td qualifier)
    // beats `thead th` on specificity and repaints that one heading as a
    // body cell, regardless of source order. Checking every column, not
    // just the ones already known to collide, catches a future column that
    // repeats the same unscoped shape.
    const columns = [
      "c-state",
      "c-lane",
      "c-seat",
      "c-stage",
      "c-live",
      "c-log",
      "c-pr",
      "c-gate",
      "c-find",
    ];

    for (const cls of columns) {
      const th = doc.querySelector(`thead th.${cls}`);
      const td = bodyRow?.querySelector(`td.${cls}`);
      // toBeTruthy, not toBeNull: bodyRow?.querySelector() yields undefined
      // (not null) when bodyRow itself is null, and undefined would pass a
      // not-toBeNull check without either cell ever being found.
      expect(th).toBeTruthy();
      expect(td).toBeTruthy();

      const headerSize = page.window.getComputedStyle(th!).fontSize;
      const bodySize = page.window.getComputedStyle(td!).fontSize;
      // The header keeps its own 10px treatment no matter which column it
      // is, and a body cell in the same column must never resolve to that
      // same size — if it does, a body-cell rule has won specificity over
      // thead th and the heading is rendering as a body cell.
      expect(headerSize).toBe("10px");
      expect(bodySize).not.toBe(headerSize);
    }
  });

  test("typing narrows the rows; clearing restores them; a wave with no surviving lanes says so; the open log survives a filter that hides its row", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const filter = doc.getElementById("filter") as unknown as HTMLInputElement;
    expect(filter).not.toBeNull();

    const dispatchInput = () => {
      const event = new (
        filter.ownerDocument!.defaultView as unknown as { Event: typeof Event }
      ).Event("input", { bubbles: true });
      filter.dispatchEvent(event);
    };

    // Initially all 5 lanes from mixedStatus (4 in T, 1 in U)
    expect(doc.querySelectorAll("tr.lane").length).toBe(5);

    // Filter to "t1" — only lane t1 matches.
    filter.value = "t1";
    dispatchInput();

    const surviving = doc.querySelectorAll("tr.lane");
    expect(surviving.length).toBe(1);
    expect(surviving[0]?.getAttribute("data-lane")).toBe("t1");

    // Wave U has no surviving lanes and says so
    const emptyU = doc.querySelector('tr.empty[data-wave="U"]');
    expect(emptyU).not.toBeNull();
    expect(emptyU?.textContent).toContain("No lanes match “t1”");

    // Open log for t1
    (surviving[0] as unknown as HTMLElement).click();
    await vi.waitFor(() => {
      expect(page.fetches).toContain("/api/log/T/t1?tail=16");
    });
    const logPane = doc.getElementById("log-pane") as unknown as HTMLElement;
    expect(logPane?.hidden).toBe(false);
    expect(doc.getElementById("log-lane")?.textContent).toBe("T/t1");

    // Now type a filter that hides t1 (e.g. "u1")
    filter.value = "u1";
    dispatchInput();

    expect(doc.querySelectorAll("tr.lane").length).toBe(1);
    expect(
      doc.querySelector('tr.lane[data-wave="T"][data-lane="t1"]'),
    ).toBeNull();
    // Wave T now has no surviving lanes
    const emptyT = doc.querySelector('tr.empty[data-wave="T"]');
    expect(emptyT).not.toBeNull();
    expect(emptyT?.textContent).toContain("No lanes match “u1”");

    // Open log pane survives even though t1 is hidden
    expect(logPane?.hidden).toBe(false);
    expect(doc.getElementById("log-lane")?.textContent).toBe("T/t1");

    // Clearing restores all rows and the selected-row indicator
    filter.value = "";
    dispatchInput();
    expect(doc.querySelectorAll("tr.lane").length).toBe(5);
    const restoredT1 = doc.querySelector(
      'tr.lane[data-wave="T"][data-lane="t1"]',
    );
    expect(restoredT1?.classList.contains("selected")).toBe(true);
    expect(logPane?.hidden).toBe(false);
  });

  test("the filter input resolves its border to the control token and carries an accessible name", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const filter = doc.getElementById("filter");
    expect(filter).not.toBeNull();
    expect(filter?.getAttribute("type")).toBe("search");
    const label = filter?.getAttribute("aria-label");
    expect(label).toBe("Filter lanes by wave or lane");

    const filterBorder = page.window.getComputedStyle(filter!).borderColor;
    const expectedBorder = page.window
      .getComputedStyle(doc.documentElement)
      .getPropertyValue("--color-border-control")
      .trim();
    expect(filterBorder).toBe(expectedBorder);

    // Verify searching by wave id and lane name
    const filterInput = filter as unknown as HTMLInputElement;
    filterInput.value = "U";
    filterInput.dispatchEvent(
      new (doc.defaultView as unknown as { Event: typeof Event }).Event(
        "input",
        {
          bubbles: true,
        },
      ),
    );
    expect(doc.querySelectorAll("tr.lane").length).toBe(1);
    expect(doc.querySelector("tr.lane")?.getAttribute("data-wave")).toBe("U");

    filterInput.value = "t2";
    filterInput.dispatchEvent(
      new (doc.defaultView as unknown as { Event: typeof Event }).Event(
        "input",
        {
          bubbles: true,
        },
      ),
    );
    expect(doc.querySelectorAll("tr.lane").length).toBe(1);
    expect(doc.querySelector("tr.lane")?.getAttribute("data-lane")).toBe("t2");
  });

  test("filtering with every wave collapsed displays the no-match empty row rather than hiding it", async () => {
    const page = await loadPage(mixedStatus);
    const doc = page.window.document;
    const filter = doc.getElementById("filter") as unknown as HTMLInputElement;

    const dispatchInput = () => {
      const event = new (
        filter.ownerDocument!.defaultView as unknown as { Event: typeof Event }
      ).Event("input", { bubbles: true });
      filter.dispatchEvent(event);
    };

    // Verify every wave is collapsed initially (page opens with defaultExpanded = false)
    const waveButtons = Array.from(doc.querySelectorAll("tr.wave button"));
    expect(waveButtons.length).toBeGreaterThan(0);
    for (const btn of waveButtons) {
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    }
    const allLanes = Array.from(doc.querySelectorAll("tr.lane"));
    for (const lane of allLanes) {
      expect((lane as unknown as HTMLElement).hidden).toBe(true);
    }

    // Filter to "t1" — Wave U has no matching lanes.
    filter.value = "t1";
    dispatchInput();

    const emptyU = doc.querySelector(
      'tr.empty[data-wave="U"]',
    ) as unknown as HTMLElement;
    expect(emptyU).not.toBeNull();
    expect(emptyU.hidden).toBe(false);
    expect(emptyU.textContent).toContain("No lanes match “t1”");

    // Filter to a query that matches no lane in any wave
    filter.value = "nomatchanywhere";
    dispatchInput();

    const emptyRows = Array.from(doc.querySelectorAll("tr.empty"));
    expect(emptyRows.length).toBe(2);
    for (const row of emptyRows) {
      expect((row as unknown as HTMLElement).hidden).toBe(false);
      expect(row.textContent).toContain("No lanes match “nomatchanywhere”");
    }

    // Toggling the wave open and closed keeps the empty row visible
    const waveUButton = doc.querySelector(
      'tr.wave[data-wave="U"] button',
    ) as unknown as HTMLElement;
    waveUButton.click();
    expect(waveUButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      (doc.querySelector('tr.empty[data-wave="U"]') as unknown as HTMLElement)
        .hidden,
    ).toBe(false);

    waveUButton.click();
    expect(waveUButton.getAttribute("aria-expanded")).toBe("false");
    expect(
      (doc.querySelector('tr.empty[data-wave="U"]') as unknown as HTMLElement)
        .hidden,
    ).toBe(false);
  });

  test("typing in the filter does not refetch the followed log", async () => {
    const page = await loadPage(
      mixedStatus,
      () => new Response("log output", { status: 200 }),
    );
    const doc = page.window.document;

    // Open log for T/t1
    const laneT1 = doc.querySelector(
      'tr.lane[data-wave="T"][data-lane="t1"]',
    ) as unknown as HTMLElement;
    laneT1.click();
    await vi.waitFor(() => {
      expect(page.fetches).toContain("/api/log/T/t1?tail=16");
    });
    const initialFetches = page.fetches.length;

    // Enable follow
    const followCheckbox = doc.getElementById(
      "log-follow",
    ) as unknown as HTMLInputElement;
    followCheckbox.checked = true;
    followCheckbox.dispatchEvent(
      new (
        followCheckbox.ownerDocument!.defaultView as unknown as {
          Event: typeof Event;
        }
      ).Event("change", {
        bubbles: true,
      }),
    );
    await vi.waitFor(() => {
      expect(page.fetches.length).toBeGreaterThan(initialFetches);
    });
    const followFetches = page.fetches.length;

    // Type multiple characters into filter
    const filter = doc.getElementById("filter") as unknown as HTMLInputElement;
    filter.value = "t";
    filter.dispatchEvent(
      new (
        filter.ownerDocument!.defaultView as unknown as { Event: typeof Event }
      ).Event("input", {
        bubbles: true,
      }),
    );
    filter.value = "t1";
    filter.dispatchEvent(
      new (
        filter.ownerDocument!.defaultView as unknown as { Event: typeof Event }
      ).Event("input", {
        bubbles: true,
      }),
    );

    // Give any microtasks/promises a turn
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Filter typing must not have triggered additional log tail fetches
    expect(page.fetches.length).toBe(followFetches);
  });

  test("a referenced token that resolves to empty raises the warning naming it; a fully-resolving page shows nothing", async () => {
    // Fully resolving page shows nothing
    const normalPage = await loadPage(mixedStatus);
    const normalWarning = normalPage.window.document.getElementById(
      "palette-warning",
    ) as unknown as HTMLElement;
    expect(normalWarning?.hidden).toBe(true);

    // Broken tokens: rename one the page references.
    const brokenCss = builtinTokensCss().replaceAll(
      "--color-brand-primary",
      "--color-brand-primary-omitted",
    );
    const brokenPage = await loadPage(mixedStatus, undefined, {
      tokensCss: brokenCss,
    });
    const brokenWarning = brokenPage.window.document.getElementById(
      "palette-warning",
    ) as unknown as HTMLElement;
    expect(brokenWarning?.hidden).toBe(false);
    expect(brokenWarning?.textContent).toContain("--color-brand-primary");
  });

  test("every token the page references resolves in /tokens.css", async () => {
    // Start a real server to test what actually gets served
    const root = mkdtempSync(join(tmpdir(), "wave-status-token-test-"));
    dirs.push(root);
    const handle = await startServer({
      port: 0,
      repoRoot: REPO_ROOT,
      config: config(),
      scanRoot: root,
      collect: async () => statusAt(),
    });
    try {
      // Derive the set of tokens the page actually references from the real HTML
      const html = await readFile(PAGE_PATH, "utf8");
      const referencedTokens = scanReferencedTokens(html);

      // Fetch what the server actually serves for /tokens.css
      const res = await new Promise<{
        status: number;
        body: string;
      }>((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port: handle.port, path: "/tokens.css" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(res.status).toBe(200);

      // Extract tokens from the served response body
      const servedTokens = new Set<string>();
      for (const match of res.body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
        servedTokens.add(match[1].toLowerCase());
      }

      // Every referenced token must be served
      const missing = Array.from(referencedTokens)
        .map((t) => t.toLowerCase())
        .filter((token) => !servedTokens.has(token));
      if (missing.length > 0) {
        throw new Error(
          `Unresolved tokens: ${missing.join(", ")}. ` +
            `Referenced: ${Array.from(referencedTokens)
              .map((t) => t.toLowerCase())
              .join(", ")}. ` +
            `Served: ${Array.from(servedTokens).join(", ")}.`,
        );
      }
      expect(missing).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  test("a reference with a fallback like var(--missing, #fff) is caught as unserved", async () => {
    const root = mkdtempSync(join(tmpdir(), "wave-status-fallback-test-"));
    dirs.push(root);
    const handle = await startServer({
      port: 0,
      repoRoot: REPO_ROOT,
      config: config(),
      scanRoot: root,
      collect: async () => statusAt(),
    });
    try {
      const html = await readFile(PAGE_PATH, "utf8");
      // Create a modified HTML with a fallback reference to an unserved token
      const modifiedHtml = html.replace(
        "</style>",
        "      .test { color: var(--color-missing-token, #ff0000); }\n    </style>",
      );
      const referencedTokens = scanReferencedTokens(modifiedHtml);

      // Fetch what the server actually serves for /tokens.css
      const res = await new Promise<{
        status: number;
        body: string;
      }>((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port: handle.port, path: "/tokens.css" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(res.status).toBe(200);

      // Extract tokens from the served response body
      const servedTokens = new Set<string>();
      for (const match of res.body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
        servedTokens.add(match[1].toLowerCase());
      }

      // The missing token should now be detected even with the fallback
      const missing = Array.from(referencedTokens)
        .map((t) => t.toLowerCase())
        .filter((token) => !servedTokens.has(token));
      expect(missing).toContain("--color-missing-token");
    } finally {
      await handle.close();
    }
  });

  test("a missing <style> block fails loudly, not silently", async () => {
    const root = mkdtempSync(join(tmpdir(), "wave-status-missing-style-test-"));
    dirs.push(root);
    const handle = await startServer({
      port: 0,
      repoRoot: REPO_ROOT,
      config: config(),
      scanRoot: root,
      collect: async () => statusAt(),
    });
    try {
      const html = await readFile(PAGE_PATH, "utf8");
      // Remove the style block entirely
      const htmlWithoutStyle = html.replace(/<style>[\s\S]*?<\/style>/g, "");
      expect(() => {
        scanReferencedTokens(htmlWithoutStyle);
      }).toThrow("page has no <style> block or it is empty");
    } finally {
      await handle.close();
    }
  });
});

/**
 * A failed collection, as the PAGE meets one. The server publishes the failure
 * with no waves, so the page has two jobs and both are about trust: say what
 * failed, in the server's own words, and show no lane row that is not from a
 * collection that happened.
 */
describe("the status page — a collection that failed", () => {
  const good = mixedStatus;

  test("no error: the banner is absent, not an empty box", async () => {
    const page = await loadPage(good);
    const banner = page.window.document.getElementById(
      "collect-error",
    ) as unknown as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.hidden).toBe(true);
    expect(banner.textContent).toBe("");
    expect(page.window.document.querySelectorAll("tr.lane").length).toBe(5);
  });

  test("an error is rendered as a banner naming the failure, and no lane survives from the last good read", async () => {
    const page = await loadPage(good);
    const doc = page.window.document;
    expect(doc.querySelectorAll("tr.lane").length).toBe(5);

    // What the server publishes when a collection throws: the reason and NO
    // waves. This is the message a malformed risk cell produces, naming the row.
    const failed = {
      generatedAt: "now",
      waves: [],
      error:
        'plan.md: row PZ1 has an invalid risk cell "high" — expected exactly **high** or exactly normal',
    };
    page.source.emit("status", JSON.stringify(failed));

    await vi.waitFor(() => {
      expect(
        (doc.getElementById("collect-error") as unknown as HTMLElement).hidden,
      ).toBe(false);
    });
    const banner = doc.getElementById(
      "collect-error",
    ) as unknown as HTMLElement;
    expect(banner.textContent).toContain("collection failed");
    expect(banner.textContent).toContain("PZ1");
    expect(banner.getAttribute("role")).toBe("alert");
    // The rows are GONE. Showing them beside the banner would let a reader
    // believe a lane row that the failed read could not vouch for.
    expect(doc.querySelectorAll("tr.lane").length).toBe(0);
    expect(doc.querySelectorAll("tr.wave").length).toBe(0);
  });

  test("a later good collection clears the banner — the two states are distinguishable", async () => {
    const page = await loadPage(good);
    const doc = page.window.document;
    page.source.emit(
      "status",
      JSON.stringify({ generatedAt: "now", waves: [], error: "gh: no auth" }),
    );
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("collect-error") as unknown as HTMLElement).hidden,
      ).toBe(false);
    });
    expect(doc.getElementById("collect-error")?.textContent).toContain(
      "gh: no auth",
    );

    page.source.emit("status", JSON.stringify(good));
    await vi.waitFor(() => {
      expect(
        (doc.getElementById("collect-error") as unknown as HTMLElement).hidden,
      ).toBe(true);
    });
    expect(doc.getElementById("collect-error")?.textContent).toBe("");
    expect(doc.querySelectorAll("tr.lane").length).toBe(5);
  });

  test("the banner renders the message as text, never as markup", async () => {
    const page = await loadPage(good);
    page.source.emit(
      "status",
      JSON.stringify({
        generatedAt: "now",
        waves: [],
        error: "<img src=x onerror=alert(1)>",
      }),
    );
    const banner = page.window.document.getElementById(
      "collect-error",
    ) as unknown as HTMLElement;
    await vi.waitFor(() => {
      expect(banner.hidden).toBe(false);
    });
    expect(banner.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(banner.querySelector("img")).toBeNull();
    expect(banner.innerHTML).toContain("&lt;img");
  });
});

describe("the status page — backlog panel", () => {
  const recordedArtifact = {
    version: 1,
    at: "2026-09-13T12:00:00.000Z",
    git: {
      branch: "feat/backlog-panel",
      head: "9f8e7d6c5b4a39281706f5e4d3c2b1a091827364",
    },
    scope: { kind: "full" as const },
    plans: ["docs/planning/a.md"],
    premises: [
      { lane: "B7", plan: "docs/planning/a.md", status: "holds" as const },
      {
        lane: "R3",
        plan: "docs/planning/r3.md",
        status: "stale" as const,
        reason: "already merged",
      },
      { lane: "N8", plan: "docs/planning/n8.md", status: "timed-out" as const },
    ],
  };

  test("the page shows 'no plan:verify run recorded' for a missing artifact", async () => {
    const status: WaveStatus = {
      ...statusAt(),
      backlog: { state: "absent" },
    };
    const page = await loadPage(status);
    const panel = page.window.document.querySelector(
      "#backlog-pane, #backlog-panel",
    );
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("no plan:verify run recorded");
  });

  test("the page shows 'unknown' for a malformed or unreadable artifact", async () => {
    const status: WaveStatus = {
      ...statusAt(),
      backlog: { state: "unknown" },
    };
    const page = await loadPage(status);
    const panel = page.window.document.querySelector(
      "#backlog-pane, #backlog-panel",
    );
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("unknown");
    expect(panel!.querySelector(".backlog-list")).toBeNull();
  });

  test("a partial run is never rendered as the whole backlog", async () => {
    const status: WaveStatus = {
      ...statusAt(),
      backlog: {
        state: "recorded",
        artifact: {
          ...recordedArtifact,
          scope: { kind: "partial", plans: ["docs/planning/a.md"] },
        },
      },
    };
    const page = await loadPage(status);
    const panel = page.window.document.querySelector(
      "#backlog-pane, #backlog-panel",
    );
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("partial");
    expect(panel!.textContent).not.toContain("full run");
  });

  test("a recorded artifact renders provenance prominently and lists premises", async () => {
    const status: WaveStatus = {
      ...statusAt(),
      backlog: { state: "recorded", artifact: recordedArtifact },
    };
    const page = await loadPage(status);
    const panel = page.window.document.querySelector(
      "#backlog-pane, #backlog-panel",
    );
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("2026-09-13T12:00:00.000Z");
    expect(panel!.textContent).toContain("feat/backlog-panel");
    expect(panel!.textContent).toContain("9f8e7d6c");
    expect(panel!.textContent).toContain("B7");
    expect(panel!.textContent).toContain("holds");
    expect(panel!.textContent).toContain("R3");
    expect(panel!.textContent).toContain("stale");
    expect(panel!.textContent).toContain("already merged");
    expect(panel!.textContent).toContain("N8");
    expect(panel!.textContent).toContain("timed-out");
  });

  test("an errored premise renders with the warning tone, not info", async () => {
    const status: WaveStatus = {
      ...statusAt(),
      backlog: {
        state: "recorded",
        artifact: {
          ...recordedArtifact,
          premises: [
            {
              lane: "E1",
              plan: "docs/planning/e.md",
              status: "error" as const,
              reason: "spawn sh ENOENT",
            },
          ],
        },
      },
    };
    const page = await loadPage(status);
    const item = page.window.document.querySelector(".backlog-item-error");
    expect(item).not.toBeNull();
    const pill = item!.querySelector(".pill");
    expect(pill).not.toBeNull();
    expect(pill!.classList.contains("warn")).toBe(true);
    expect(pill!.classList.contains("info")).toBe(false);
  });

  test("the backlog renderer has no defensive fallbacks for schema fields guaranteed by parseArtifact", () => {
    const html = readFileSync(PAGE_PATH, "utf8");
    const backlogFnMatch = html.match(
      /function renderBacklog\(backlog\) \{[\s\S]*?\n {6}\}/,
    );
    expect(backlogFnMatch).not.toBeNull();
    const fnText = backlogFnMatch![0];
    expect(fnText).not.toContain("artifact.scope &&");
    expect(fnText).not.toContain("|| []");
    expect(fnText).not.toContain("artifact.git ?");
    expect(fnText).not.toContain("!artifact.premises ||");
  });
});
