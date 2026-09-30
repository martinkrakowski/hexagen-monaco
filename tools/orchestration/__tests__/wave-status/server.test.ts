import { afterEach, describe, test, expect, vi, type Mock } from "vitest";

// The default-collection test exercises the realDeps wiring, but its `gh` and
// `pgrep` calls are stubbed at the execFile boundary (they are exercised for
// real in collect.test.ts) so the suite never waits on the network.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { execFile } from "node:child_process";

import { utimesSync, watch as fsWatch } from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import {
  BUILTIN_TOKENS_CSS,
  defaultDeps,
  extractDarkBlock,
  extractRootBlock,
  resolvePort,
  routeFor,
  startServer,
  type ServerHandle,
} from "../../src/wave-status/server.js";
import {
  realDepsFor,
  type CollectDeps,
} from "../../src/wave-status/lib/collect.js";
import { emptyConfig, type Config } from "../../src/internal/config.js";
import type { WaveStatus } from "../../src/internal/wave-types.js";

type ExecCallback = (error: Error | null, stdout: string) => void;
(execFile as unknown as Mock).mockImplementation(
  (
    file: string,
    _args: readonly string[],
    optionsOrCallback: ExecCallback | Record<string, unknown>,
    maybeCallback?: ExecCallback,
  ) => {
    const callback = (
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback
    ) as ExecCallback;
    queueMicrotask(() => callback(null, file === "gh" ? "[]" : ""));
    return undefined;
  },
);

const handles: ServerHandle[] = [];
const roots: string[] = [];

/** The page the bin serves, read from its own shipped path. */
const PAGE_PATH = fileURLToPath(
  new URL("../../public/wave-status/index.html", import.meta.url),
);

/** The repository every test claims, and the repository root it claims it from. */
const REPO = "acme/demo";
const REPO_ROOT = "/repo";

/** The overlay every test runs with: one repository, one plan directory, no ports refused. */
function config(overrides: Partial<Config> = {}): Config {
  return { ...emptyConfig(), repo: REPO, ...overrides };
}

afterEach(async () => {
  while (handles.length > 0) {
    await handles.pop()?.close();
  }
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

type StartArgs = Omit<
  Parameters<typeof startServer>[0],
  "config" | "repoRoot"
> & {
  readonly config?: Config;
  readonly repoRoot?: string;
};

/**
 * The real process-facing deps with the overlay's settings filled in and one
 * seam replaced. The config-derived fields are no longer optional, so a test
 * that spreads the real deps has to say which repository it is collecting for.
 */
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

/** Start the server with the overlay-derived arguments filled in, and track it for cleanup. */
async function start(args: StartArgs): Promise<ServerHandle> {
  const handle = await startServer({
    ...args,
    repoRoot: args.repoRoot ?? REPO_ROOT,
    config: args.config ?? config(),
  });
  handles.push(handle);
  return handle;
}

/**
 * Parses the served page the way a browser would and asserts one `link`
 * element carries BOTH `rel="stylesheet"` and `href="/tokens.css"` — the two
 * facts together. The exact-string form this replaces (`href="/tokens.css"`)
 * matched any element with that href, an `<a>` included, and a formatter's
 * reflow of the tag broke the whole-tag string match; a DOM query survives
 * reflow and still fails when the tag is wrong.
 */
function expectStylesheetLink(html: string): void {
  const window = new Window({
    url: "http://127.0.0.1/",
    settings: {
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    window.document.write(html);
    const stylesheet = window.document.querySelector('link[rel="stylesheet"]');
    expect(stylesheet).not.toBeNull();
    expect(stylesheet?.getAttribute("href")).toBe("/tokens.css");
  } finally {
    window.happyDOM.close();
  }
}

/**
 * A fixture wave-log root: waveT with a >1 KB log, waveU with a small one.
 * The two lane logs get pinned mtimes (T the newer, by a minute) so a test
 * that reads the collected list back has one wave order to expect: the
 * collector's newest-first rule is a function of lane-log activity, so
 * sub-second write order here would make that assertion wall-clock luck.
 */
/**
 * Name lanes in a wave directory's events. The log route serves only a lane the
 * collector would list, and an event is what creates a lane, so a log with no
 * event is not one.
 */
async function nameLanes(
  waveDir: string,
  wave: string,
  lanes: readonly string[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    join(waveDir, "events.jsonl"),
    lanes
      .map(
        (lane) =>
          `${JSON.stringify({
            ts: "2026-09-07T17:00:00Z",
            wave,
            lane,
            stage: "gate",
            event: "started",
            ...extra,
          })}\n`,
      )
      .join(""),
  );
}

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wave-status-srv-"));
  roots.push(root);
  await mkdir(join(root, "waveT"));
  await mkdir(join(root, "waveU"));
  await mkdir(join(root, "notwave"));
  await writeFile(join(root, "loose.txt"), "not a wave dir\n");
  await writeFile(
    join(root, "waveT", "t1.log"),
    `${"x".repeat(4096)}\nEXIT 0\n`,
  );
  await writeFile(join(root, "waveT", "gate-t1.log"), "GATE EXIT 0\n");
  await writeFile(
    join(root, "waveT", "events.jsonl"),
    `${JSON.stringify({
      ts: "2026-09-07T17:00:00Z",
      wave: "T",
      lane: "t1",
      stage: "gate",
      event: "started",
    })}\n`,
  );
  await writeFile(join(root, "waveU", "u2.log"), "short\n");
  await nameLanes(join(root, "waveU"), "U", ["u2"]);
  const base = Date.now();
  const tMtime = new Date(base - 60_000);
  const uMtime = new Date(base - 600_000);
  utimesSync(join(root, "waveT", "t1.log"), tMtime, tMtime);
  utimesSync(join(root, "waveU", "u2.log"), uMtime, uMtime);
  return root;
}

/**
 * The collected status varies with `version` in real content (liveness and log
 * bytes) — `generatedAt` alone is deliberately ignored by the SSE change
 * detection, so a stub that only clocks it would never broadcast.
 */
const statusAt = (version: number): WaveStatus => ({
  generatedAt: `v${version}`,
  waves: [
    {
      id: "T",
      lanes: [
        {
          wave: "T",
          lane: "t1",
          derived: {
            alive: version > 0,
            log: { bytes: version, mtimeMs: 0, tail: "" },
          },
          disagreements: [],
        },
      ],
    },
  ],
});

function get(
  port: number,
  path: string,
  method = "GET",
  timeoutMs = 2_000,
): Promise<{
  status: number;
  headers: IncomingMessage["headers"];
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value: {
      status: number;
      headers: IncomingMessage["headers"];
      body: Buffer;
    }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const options: RequestOptions = { host: "127.0.0.1", port, path, method };
    const req = httpRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        succeed({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
      res.on("error", (error) =>
        fail(error instanceof Error ? error : new Error(String(error))),
      );
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      fail(
        new Error(
          `timed out after ${timeoutMs}ms waiting for ${method} ${path}`,
        ),
      );
    });
    req.on("error", (error) =>
      fail(error instanceof Error ? error : new Error(String(error))),
    );
    req.end();
  });
}

/** Reads `status` events off an SSE response as their data payloads. */
class SseReader {
  readonly events: string[] = [];
  private readonly buffer: { text: string } = { text: "" };
  private tail = 0;

  constructor(res: IncomingMessage) {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      this.buffer.text += chunk;
      for (;;) {
        const end = this.buffer.text.indexOf("\n\n", this.tail);
        if (end < 0) break;
        const block = this.buffer.text.slice(this.tail, end);
        this.tail = end + 2;
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("\n");
        this.events.push(data);
      }
    });
  }

  async waitFor(count: number, timeoutMs = 2_000): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.events.length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${count} SSE events; have ${this.events.length}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.events;
  }

  async expectQuiet(ms: number): Promise<void> {
    const before = this.events.length;
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (this.events.length !== before) {
      throw new Error(
        `expected quiet, received ${this.events.length - before} extra event(s)`,
      );
    }
  }
}

async function openStream(
  port: number,
): Promise<{ reader: SseReader; response: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/api/stream" },
      (response) => {
        resolve({ reader: new SseReader(response), response });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("resolvePort — the overlay owns the port", () => {
  test("with no PORT the answer is the overlay's own waveStatusPort", () => {
    expect(resolvePort({}, config())).toBe(4318);
    expect(resolvePort({}, config({ waveStatusPort: 4520 }))).toBe(4520);
    // An empty PORT is unset, by POSIX `${VAR:-word}` semantics.
    expect(resolvePort({ PORT: "" }, config({ waveStatusPort: 4520 }))).toBe(
      4520,
    );
  });

  test("PORT overrides the overlay for one run", () => {
    expect(
      resolvePort({ PORT: "4400" }, config({ waveStatusPort: 4520 })),
    ).toBe(4400);
  });

  test("non-numeric and out-of-range ports are refused", () => {
    expect(() => resolvePort({ PORT: "abc" }, config())).toThrow(
      /invalid PORT/,
    );
    expect(() => resolvePort({ PORT: "-1" }, config())).toThrow(/invalid PORT/);
    expect(() => resolvePort({ PORT: "99999" }, config())).toThrow(
      /invalid PORT/,
    );
  });

  // The three cases that decide whether the port is this package's answer or one
  // project's: a port nothing forbade is allowed whatever its number, a port the
  // FILE forbade is refused whatever asked for it, and the refusal names both the
  // port and the setting that forbade it so the operator can act on it.
  test("PORT=3000 is ALLOWED when the file forbids no ports — RED PROOF", () => {
    expect(resolvePort({ PORT: "3000" }, config({ forbiddenPorts: [] }))).toBe(
      3000,
    );
  });

  test("PORT=3000 is refused when the file lists it, naming the port and forbiddenPorts", () => {
    expect(() =>
      resolvePort({ PORT: "3000" }, config({ forbiddenPorts: [3000, 3001] })),
    ).toThrow(/refusing to bind port 3000/);
    expect(() =>
      resolvePort({ PORT: "3000" }, config({ forbiddenPorts: [3000, 3001] })),
    ).toThrow(/forbiddenPorts/);
    expect(() =>
      resolvePort({ PORT: "3001" }, config({ forbiddenPorts: [3000, 3001] })),
    ).toThrow(/refusing to bind port 3001/);
  });

  test("a waveStatusPort the file forbids is refused too — PORT cannot smuggle it past", () => {
    // The red proof that matters: the source's own port, forbidden, stays
    // forbidden. Nothing here is a reserved number; the file said so.
    expect(() =>
      resolvePort({}, config({ waveStatusPort: 4520, forbiddenPorts: [4520] })),
    ).toThrow(/refusing to bind port 4520/);
    // And a different forbidden number, neither of the two the source hardcoded.
    expect(() =>
      resolvePort({}, config({ waveStatusPort: 4631, forbiddenPorts: [4631] })),
    ).toThrow(/refusing to bind port 4631/);
  });
});

describe("routeFor — the route table, enumerated", () => {
  test("the table is exactly {GET /, GET /tokens.css, GET /api/status, GET /api/stream, GET /api/log/:wave/:lane}", () => {
    expect(routeFor("GET", "/")).toEqual({ kind: "index" });
    expect(routeFor("GET", "/tokens.css")).toEqual({ kind: "tokens" });
    expect(routeFor("GET", "/api/status")).toEqual({ kind: "status" });
    expect(routeFor("GET", "/api/stream")).toEqual({ kind: "stream" });
    expect(routeFor("GET", "/api/log/T/t1")).toEqual({
      kind: "log",
      wave: "T",
      lane: "t1",
      search: expect.any(URLSearchParams),
    });
  });

  test("an absent method or request target still routes", () => {
    expect(routeFor(undefined, "/")).toBe("methodNotAllowed");
    expect(routeFor("GET", undefined)).toEqual({ kind: "index" });
  });

  test("any other method is 405 — including DELETE on the log route", () => {
    expect(routeFor("POST", "/api/status")).toBe("methodNotAllowed");
    expect(routeFor("DELETE", "/api/log/T/t1")).toBe("methodNotAllowed");
    expect(routeFor("PUT", "/")).toBe("methodNotAllowed");
  });

  test("any other path is 404", () => {
    expect(routeFor("GET", "/nope")).toEqual({ kind: "notFound" });
    expect(routeFor("GET", "/api/status/extra")).toEqual({ kind: "notFound" });
    expect(routeFor("GET", "/api/log/T")).toEqual({ kind: "notFound" });
    expect(routeFor("GET", "/api/log/T/t1/extra")).toEqual({
      kind: "notFound",
    });
  });

  test("path segments are validated — traversal is 404", () => {
    expect(routeFor("GET", "/api/log/T/../../etc/passwd")).toEqual({
      kind: "notFound",
    });
    expect(routeFor("GET", "/api/log/T/%2e%2e")).toEqual({ kind: "notFound" });
    // URL does not canonicalize this one: two segments, but they fail SEGMENT.
    expect(routeFor("GET", "/api/log/..%2F..%2Fetc/passwd")).toEqual({
      kind: "notFound",
    });
    expect(routeFor("GET", "/api/log/T/..hidden")).toEqual({
      kind: "notFound",
    });
  });

  test("an unparseable request target is 404, not a crash", () => {
    expect(routeFor("GET", "http://[")).toEqual({ kind: "notFound" });
  });
});

describe("extractDarkBlock", () => {
  test("returns the .dark block through its matching brace", () => {
    expect(
      extractDarkBlock(
        ":root {\n  --color-background: #ffffff;\n}\n.dark {\n  --color-background: #0f0f0f;\n}",
      ),
    ).toBe(".dark {\n  --color-background: #0f0f0f;\n}");
  });

  test("a brace inside a comment does not close the block early", () => {
    // `}` and `*x` inside the comment exercise both comment-closing branches.
    expect(extractDarkBlock(".dark { /* *x } */ --color-a: 1; }")).toBe(
      ".dark { /* *x } */ --color-a: 1; }",
    );
  });

  test("a brace inside a double-quoted string is ignored", () => {
    expect(extractDarkBlock('.dark { --color-a: "}"; }')).toBe(
      '.dark { --color-a: "}"; }',
    );
  });

  test("an escaped quote inside a string does not close it", () => {
    expect(
      extractDarkBlock('.dark { --color-a: "\\" }"; --color-b: 2; }'),
    ).toBe('.dark { --color-a: "\\" }"; --color-b: 2; }');
  });

  test("a brace inside a single-quoted string is ignored", () => {
    expect(extractDarkBlock(".dark { --color-a: '}'; }")).toBe(
      ".dark { --color-a: '}'; }",
    );
  });

  test("nested braces balance before the block closes", () => {
    expect(extractDarkBlock(".dark { --color-a: {nested}; }")).toBe(
      ".dark { --color-a: {nested}; }",
    );
  });

  test("a .dark selector with no brace, or a block that never closes, is undefined", () => {
    expect(extractDarkBlock(".dark")).toBeUndefined();
    expect(extractDarkBlock(".dark { --color-a: 1;")).toBeUndefined();
    expect(extractDarkBlock(".dark /* no closing brace */")).toBeUndefined();
  });

  test("a class that merely starts like .dark is not the block", () => {
    expect(
      extractDarkBlock(
        ".own { --a: 1; }\n.darkish { --c: 3; }\n.dark { --b: 2; }",
      ),
    ).toBe(".dark { --b: 2; }");
  });

  test("a decimal value inside a rule body is not a selector", () => {
    expect(extractDarkBlock(":root { --x: .5; }\n.dark { --y: .5; }")).toBe(
      ".dark { --y: .5; }",
    );
  });

  test("the BUILT-IN set extracts to a .dark block of token declarations", () => {
    // A fixture without comments is what let a comment-blind scan ship: a file
    // whose first ".dark" sits inside its header comment made the extraction
    // start there, serving prose plus the light block. The built-in set carries
    // its own explanatory comments, so the same hazard applies to it.
    const dark = extractDarkBlock(BUILTIN_TOKENS_CSS) ?? "";
    const open = dark.indexOf("{");
    expect(open).toBeGreaterThan(0);
    // The extracted rule's selector is exactly `.dark`.
    expect(dark.slice(0, open).trim()).toBe(".dark");
    // The route serves this extract verbatim. With comments stripped, every
    // non-empty line must be a `--name: value;` declaration — color-scheme is
    // the one standard declaration the block carries beside its tokens — so
    // prose can never again pass as a stylesheet.
    const lines = dark
      .slice(open + 1, dark.lastIndexOf("}"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^(--[A-Za-z0-9-]+|color-scheme)\s*:\s*[^;]+;$/);
    }
  });
});

describe("extractRootBlock", () => {
  test("returns the :root block through its matching brace", () => {
    expect(
      extractRootBlock(
        ":root {\n  --color-background: #ffffff;\n}\n.dark {\n  --color-background: #0f0f0f;\n}",
      ),
    ).toBe(":root {\n  --color-background: #ffffff;\n}");
  });

  test("a brace inside a comment does not close the block early", () => {
    expect(extractRootBlock(":root { /* *x } */ --color-a: 1; }")).toBe(
      ":root { /* *x } */ --color-a: 1; }",
    );
  });

  test("a brace inside a double-quoted string is ignored", () => {
    expect(extractRootBlock(':root { --color-a: "}"; }')).toBe(
      ':root { --color-a: "}"; }',
    );
  });

  test("an escaped quote inside a string does not close it", () => {
    expect(
      extractRootBlock(':root { --color-a: "\\" }"; --color-b: 2; }'),
    ).toBe(':root { --color-a: "\\" }"; --color-b: 2; }');
  });

  test("a brace inside a single-quoted string is ignored", () => {
    expect(extractRootBlock(":root { --color-a: '}'; }")).toBe(
      ":root { --color-a: '}'; }",
    );
  });

  test("nested braces balance before the block closes", () => {
    expect(extractRootBlock(":root { --color-a: {nested}; }")).toBe(
      ":root { --color-a: {nested}; }",
    );
  });

  test("a :root selector with no brace, or a block that never closes, is undefined", () => {
    expect(extractRootBlock(":root")).toBeUndefined();
    expect(extractRootBlock(":root { --color-a: 1;")).toBeUndefined();
    expect(extractRootBlock(":root /* no closing brace */")).toBeUndefined();
  });

  test("a selector that merely starts like :root is not the block", () => {
    expect(
      extractRootBlock(
        ".own { --a: 1; }\n:rootish { --c: 3; }\n:root { --b: 2; }",
      ),
    ).toBe(":root { --b: 2; }");
  });

  test(":root.dark, :root > body, and :root[data-x] are rejected", () => {
    expect(extractRootBlock(":root.dark { --color: 1; }")).toBeUndefined();
    expect(extractRootBlock(":root > body { --color: 1; }")).toBeUndefined();
    expect(extractRootBlock(":root[data-x] { --color: 1; }")).toBeUndefined();
  });

  test(":root alone and :root within a comma-separated list are accepted", () => {
    expect(extractRootBlock(":root { --color: 1; }")).toBe(
      ":root { --color: 1; }",
    );
    expect(extractRootBlock(":root, html { --color: 1; }")).toBe(
      ":root, html { --color: 1; }",
    );
    expect(extractRootBlock("html, :root { --color: 1; }")).toBe(
      "html, :root { --color: 1; }",
    );
  });

  test("a top-level at-rule or leading brace without selector is handled", () => {
    expect(extractRootBlock('@import "base.css";\n:root { --color: 1; }')).toBe(
      ":root { --color: 1; }",
    );
    expect(extractRootBlock("{ --color: 1; }")).toBeUndefined();
  });

  test("the BUILT-IN set extracts to a :root block of token declarations", () => {
    const root = extractRootBlock(BUILTIN_TOKENS_CSS) ?? "";
    const open = root.indexOf("{");
    expect(open).toBeGreaterThan(0);
    expect(root.slice(0, open).trim()).toBe(":root");
    const lines = root
      .slice(open + 1, root.lastIndexOf("}"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^(--[A-Za-z0-9-]+|color-scheme)\s*:\s*[^;]+;$/);
    }
  });
});

describe("the built-in token set", () => {
  /** Every custom property the page's own stylesheet references. */
  async function referencedTokens(): Promise<Set<string>> {
    const html = await readFile(PAGE_PATH, "utf8");
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
    if (style === undefined) throw new Error("the page has no <style> block");
    const referenced = new Set<string>();
    for (const m of style.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(?:,|\))/gi)) {
      referenced.add(m[1]);
    }
    expect(referenced.size).toBeGreaterThan(0);
    return referenced;
  }

  test("it defines EVERY custom property the page references, and nothing else", async () => {
    // The page declares no --color-* of its own, so a name it references and
    // the served sheet does not define is a token that resolves to nothing —
    // and the page's own guard can only say so after the fact. The built-in set
    // is generated against this list, and this test is what keeps the two in
    // step.
    const referenced = await referencedTokens();
    const declared = new Set(
      [...BUILTIN_TOKENS_CSS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );
    const missing = [...referenced]
      .filter((name) => !declared.has(name))
      .sort();
    expect(
      missing,
      `the built-in set does not define: ${missing.join(", ")}`,
    ).toEqual([]);
    // And it carries nothing the page never asks for: a name here that the page
    // dropped is a token nothing renders, and a name it never had is drift.
    const unused = [...declared].filter((name) => !referenced.has(name)).sort();
    expect(
      unused,
      `the built-in set declares unused tokens: ${unused.join(", ")}`,
    ).toEqual([]);
  });

  test("its light values are greyscale and it carries a dark block", () => {
    const root = extractRootBlock(BUILTIN_TOKENS_CSS) ?? "";
    const dark = extractDarkBlock(BUILTIN_TOKENS_CSS) ?? "";
    expect(root).not.toBe("");
    expect(dark).not.toBe("");
    // Neutral on purpose: a packaged tool must not ship one project's palette.
    // Every hex in the light block is R==G==B.
    const values = [...root.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
    expect(values.length).toBeGreaterThan(0);
    for (const hex of values) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect({ hex, greyscale: r === g && g === b }).toEqual({
        hex,
        greyscale: true,
      });
    }
    // The dark block really is dark: its background is darker than the light one's.
    const backgroundOf = (block: string): string =>
      /--color-background:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1] ?? "";
    expect(backgroundOf(dark) < backgroundOf(root)).toBe(true);
  });

  test("it is served when the project set no tokensCssPath, and it resolves every colour the page uses", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/tokens.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.body.toString("utf8")).toBe(BUILTIN_TOKENS_CSS);
  });

  test("defaultDeps refuses without a repository, and otherwise carries the overlay's settings", () => {
    expect(() => defaultDeps(REPO_ROOT, emptyConfig())).toThrow(
      /no repository is configured/,
    );
    const deps: CollectDeps = defaultDeps(
      REPO_ROOT,
      config({ planDir: "plans", requiredCheck: "^CI" }),
    );
    expect(deps.requiredCheck).toBe("^CI");
    expect(deps.repo).toBe(REPO);
    expect(deps.repoRoot).toBe(REPO_ROOT);
    expect(deps.planningDir).toBe("/repo/plans");
    expect(deps.waveLogDir).toBeUndefined();
    expect(
      defaultDeps(REPO_ROOT, config({ waveLogDir: "/var/log/waves" }))
        .waveLogDir,
    ).toBe("/var/log/waves");
  });
});

describe("the server over real HTTP", () => {
  test("GET / serves the page", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const html = res.body.toString("utf8");
    expect(html).toContain("<table");
    expectStylesheetLink(html);
    expect(html).toContain("stage");
    expect(html).toContain("liveness");
    expect(html).toContain(
      '<button type="button" class="wave-band" tabindex="0" aria-expanded=',
    );
    expect(html).toContain('addEventListener("click"');
    expect(html).toContain("esc(detail.fixed");
    expect(html).toContain("clearInterval(pollTimer)");
  });

  test("GET / is 500 when the page cannot be read", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
      indexHtmlPath: "/definitely/missing/index.html",
    });
    expect((await get(handle.port, "/")).status).toBe(500);
  });

  test("GET /tokens.css serves the app's tokens with :root as base and .dark after it", async () => {
    const root = await makeFixture();
    const tokensPath = join(root, "tokens.css");
    await writeFile(
      tokensPath,
      [
        ":root {",
        "  --color-background: #ffffff;",
        "  --color-surface-2: #f1f5f9;",
        "  --color-brand-primary: #3b82f6;",
        "}",
        ".dark {",
        "  --color-background: #0f0f0f;",
        "  --color-surface-2: #262626;",
        "}",
        "",
      ].join("\n"),
    );
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      tokensCssPath: tokensPath,
    });
    const res = await get(handle.port, "/tokens.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    const body = res.body.toString("utf8");
    expect(body).toContain("--color-background");
    expect(body).toContain("--color-surface-2");
    expect(body).toContain("--color-brand-primary: #3b82f6");
    // Verify the cascade order: :root first, .dark second, so dark overrides win.
    const rootIndex = body.indexOf(":root {");
    const darkIndex = body.indexOf(".dark {");
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(darkIndex).toBeGreaterThan(rootIndex);
    // Dark override resolves correctly
    const window = new Window({ url: "http://127.0.0.1/" });
    window.document.write(
      '<html class="dark"><head></head><body></body></html>',
    );
    const style = window.document.createElement("style");
    style.textContent = body;
    window.document.head.appendChild(style);
    const cs = window.getComputedStyle(window.document.documentElement);
    expect(cs.getPropertyValue("--color-background")).toBe("#0f0f0f");
    expect(cs.getPropertyValue("--color-surface-2")).toBe("#262626");
    expect(cs.getPropertyValue("--color-brand-primary")).toBe("#3b82f6");
    window.happyDOM.close();
  });

  test("the overlay's tokensCssPath is resolved from the repository root and served", async () => {
    // The bin may be started from any directory inside the project, so a
    // repo-relative tokens file has to resolve from the root — not from the cwd.
    const scanRoot = await makeFixture();
    const repoRoot = await mkdtemp(join(tmpdir(), "wave-status-repo-"));
    roots.push(repoRoot);
    await mkdir(join(repoRoot, "styles"), { recursive: true });
    const written = join(repoRoot, "styles", "tokens.css");
    await writeFile(
      written,
      ":root {\n  --color-background: #ffffff;\n}\n.dark {\n  --color-background: #101010;\n}\n",
    );
    const handle = await start({
      port: 0,
      scanRoot,
      repoRoot,
      config: config({ tokensCssPath: "styles/tokens.css" }),
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/tokens.css");
    expect(res.status).toBe(200);
    expect(res.body.toString("utf8")).toContain("--color-background: #ffffff");
    expect(res.body.toString("utf8")).toContain("--color-background: #101010");
  });

  test("GET /tokens.css is 500 naming the file when it cannot be read", async () => {
    const root = await makeFixture();
    const missing = join(root, "does-not-exist", "tokens.css");
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      tokensCssPath: missing,
    });
    const res = await get(handle.port, "/tokens.css");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body.toString("utf8")).toContain(missing);
  });

  test("GET /tokens.css is 500 naming the file when it has no :root block", async () => {
    const root = await makeFixture();
    const tokensPath = join(root, "tokens.css");
    await writeFile(tokensPath, ".dark { --color-background: #0f0f0f; }\n");
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      tokensCssPath: tokensPath,
    });
    const res = await get(handle.port, "/tokens.css");
    expect(res.status).toBe(500);
    expect(res.body.toString("utf8")).toContain(tokensPath);
    expect(res.body.toString("utf8")).toContain("has no :root block");
  });

  test("GET /tokens.css is 500 naming the file when it has no dark block", async () => {
    const root = await makeFixture();
    const tokensPath = join(root, "tokens.css");
    await writeFile(tokensPath, ":root { --color-background: #ffffff; }\n");
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      tokensCssPath: tokensPath,
    });
    const res = await get(handle.port, "/tokens.css");
    expect(res.status).toBe(500);
    expect(res.body.toString("utf8")).toContain(tokensPath);
    expect(res.body.toString("utf8")).toContain("has no dark block");
  });

  test("every --color-* the page references resolves to a non-empty value", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    const pageRes = await get(handle.port, "/");
    const tokensRes = await get(handle.port, "/tokens.css");
    expect(pageRes.status).toBe(200);
    expect(tokensRes.status).toBe(200);
    const html = pageRes.body.toString("utf8");
    const css = tokensRes.body.toString("utf8");
    const styleMatches = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    const referenced = new Set<string>();
    for (const match of styleMatches) {
      for (const m of match[1].matchAll(/var\(\s*(--color-[a-z0-9-]+)/g)) {
        referenced.add(m[1]);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    const window = new Window({ url: "http://127.0.0.1/" });
    window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ""));
    const style = window.document.createElement("style");
    style.textContent = css;
    window.document.head.appendChild(style);
    const cs = window.getComputedStyle(window.document.documentElement);
    for (const token of referenced) {
      const val = cs.getPropertyValue(token).trim();
      expect(val, `token ${token} must resolve`).not.toBe("");
    }
    window.happyDOM.close();
  });

  test("the page declares no --color-* custom property of its own", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/");
    expect(res.status).toBe(200);
    const html = res.body.toString("utf8");
    // A copied token value would recreate the drift; any --color-* declaration
    // in the page fails this build.
    expect(html).not.toMatch(/--color-[a-z0-9-]+:/);
    // And yet the page does link the served tokens.
    expectStylesheetLink(html);
  });

  test("the page's root element carries the class the served tokens are scoped to", async () => {
    const root = await makeFixture();
    const tokensPath = join(root, "tokens.css");
    await writeFile(
      tokensPath,
      [
        ":root {",
        "  --color-background: #ffffff;",
        "}",
        ".dark {",
        "  --color-background: #0f0f0f;",
        "}",
        "",
      ].join("\n"),
    );
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      tokensCssPath: tokensPath,
    });
    const page = await get(handle.port, "/");
    const tokens = await get(handle.port, "/tokens.css");
    expect(page.status).toBe(200);
    expect(tokens.status).toBe(200);
    // The two ends of the <link> are asserted together, from what each side
    // actually serves: the class(es) the served selector requires must be
    // carried by the page's root element. Neither side is asserted literally,
    // so a page that loses its class, and a block re-scoped to another class
    // — or served without any selector at all — each fail here.
    const css = tokens.body.toString("utf8");
    const scoped = [...css.matchAll(/(?:^|\})\s*([^{]+)\{/g)].flatMap((m) =>
      [...m[1].matchAll(/\.([A-Za-z][\w-]*)/g)].map((c) => c[1]),
    );
    expect(scoped.length).toBeGreaterThan(0);
    const html = page.body.toString("utf8");
    const rootTag = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    const classes = (rootTag.match(/\bclass\s*=\s*["']([^"']*)["']/)?.[1] ?? "")
      .split(/\s+/)
      .filter(Boolean);
    for (const name of scoped) expect(classes).toContain(name);
  });

  test("GET /api/status returns the collected WaveStatus as JSON", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/api/status");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(res.body.toString("utf8")) as WaveStatus;
    expect(parsed.generatedAt).toEqual(expect.any(String));
    expect(parsed.waves).toEqual(statusAt(0).waves);
  });

  test("GET /api/status is 200 with the reason in the body, never a bare 500", async () => {
    // The source answered 500 "internal error" — a status code and a word that
    // names no step, no plan row and no command. The request did not fail; the
    // COLLECTION did, and the body is where the reason belongs.
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => {
        throw new Error("collect exploded");
      },
    });
    const res = await get(handle.port, "/api/status", "GET", 5_000);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body.toString("utf8")) as {
      waves: unknown[];
      error?: string;
    };
    expect(body.error).toBe("collect exploded");
    expect(body.waves).toEqual([]);
  });

  test("POST /api/status is 405; DELETE on the log route is 405; unknown paths are 404", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    const post = await get(handle.port, "/api/status", "POST");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET");
    expect((await get(handle.port, "/api/log/T/t1", "DELETE")).status).toBe(
      405,
    );
    expect((await get(handle.port, "/nope")).status).toBe(404);
    expect((await get(handle.port, "/api/log/T/../../etc/passwd")).status).toBe(
      404,
    );
  });

  test("GET /api/log/T/t1?tail=1 returns exactly the last 1 KB", async () => {
    const root = await makeFixture();
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    const whole = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(root, "waveT", "t1.log")),
    );
    const res = await get(handle.port, "/api/log/T/t1?tail=1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body.length).toBe(1024);
    expect(res.body.equals(whole.subarray(whole.length - 1024))).toBe(true);
  });

  test("a lane log that is a symlink out of the scan root is 404, tail and full=1 alike", async () => {
    const root = await makeFixture();
    const outside = await mkdtemp(join(tmpdir(), "wave-status-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.txt"), "not this repository's\n");
    await mkdir(join(root, "waveS"));
    await nameLanes(join(root, "waveS"), "S", ["s1"]);
    await symlink(join(outside, "secret.txt"), join(root, "waveS", "s1.log"));
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    expect((await get(handle.port, "/api/log/S/s1")).status).toBe(404);
    expect((await get(handle.port, "/api/log/S/s1?full=1")).status).toBe(404);
    // A regular log beside it is still served.
    expect((await get(handle.port, "/api/log/T/t1?tail=1")).status).toBe(200);
  });

  test("the log route applies collect's scoping: another repository's wave and a lane no event names are 404", async () => {
    const root = await makeFixture();
    await mkdir(join(root, "waveO"));
    await nameLanes(join(root, "waveO"), "O", ["o1"], { repo: "other/repo" });
    await writeFile(join(root, "waveO", "o1.log"), "belongs elsewhere\n");
    // A wave of this repository, whose directory also holds a log no event names.
    await mkdir(join(root, "waveM"));
    await nameLanes(join(root, "waveM"), "M", ["m1"], { repo: REPO });
    await writeFile(join(root, "waveM", "m1.log"), "mine\n");
    await writeFile(join(root, "waveM", "litter.log"), "a probe\n");
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      deps: { ...realDepsFor(REPO_ROOT), repo: REPO },
    });
    expect((await get(handle.port, "/api/log/O/o1")).status).toBe(404);
    expect((await get(handle.port, "/api/log/O/o1?full=1")).status).toBe(404);
    expect((await get(handle.port, "/api/log/M/litter")).status).toBe(404);
    const mine = await get(handle.port, "/api/log/M/m1");
    expect(mine.status).toBe(200);
    expect(mine.body.toString("utf8")).toBe("mine\n");
  });

  test("a >1 MB log is tailed without reading the whole file; ?tail=99999 is 400", async () => {
    const root = await mkdtemp(join(tmpdir(), "wave-status-big-"));
    roots.push(root);
    await mkdir(join(root, "waveT"));
    await nameLanes(join(root, "waveT"), "T", ["t1", "t2"]);
    const payload = Buffer.concat([
      Buffer.alloc(1_500_000, 0x61),
      Buffer.from("TAILEND\n"),
    ]);
    // The route serves the realpath (a symlinked temp dir resolves), so the
    // byte counter below compares against that spelling.
    await writeFile(join(root, "waveT", "t1.log"), payload);
    const logPath = await realpath(join(root, "waveT", "t1.log"));

    let bytesRead = 0;
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      deps: {
        ...realDepsFor(REPO_ROOT),
        open: async (path) => {
          const fh = await realDepsFor(REPO_ROOT).open(path);
          return {
            stat: () => fh.stat(),
            read: async (buffer, offset, length, position) => {
              const result = await fh.read(buffer, offset, length, position);
              if (path === logPath) bytesRead += result.bytesRead;
              return result;
            },
            close: () => fh.close(),
          };
        },
      },
    });

    const res = await get(handle.port, "/api/log/T/t1?tail=1");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1024);
    expect(res.body.equals(payload.subarray(payload.length - 1024))).toBe(true);
    expect(bytesRead).toBe(1024);
    expect(bytesRead).toBeLessThan(payload.length);

    const capped = await get(handle.port, "/api/log/T/t1?tail=99999");
    expect(capped.status).toBe(400);
  });

  // DELETED IN THE PORT: the source injected a SECOND, legacy root and served
  // lane logs out of it. A scan that reads a second root is how one project's
  // waves are joined against another repository's pull requests, so there is one
  // root now and nothing to inject. Its replacement is the test above, which
  // proves a log outside the one scan root is 404.
  test("a wave directory outside the scan root is 404, not a second root's log", async () => {
    const scanRoot = await makeFixture();
    const elsewhere = await mkdtemp(join(tmpdir(), "wave-status-other-"));
    roots.push(elsewhere);
    await mkdir(join(elsewhere, "waveOther"));
    await writeFile(join(elsewhere, "waveOther", "o1.log"), "OTHER_ROOT\n");

    const handle = await start({
      port: 0,
      scanRoot,
      collect: async () => statusAt(0),
    });

    expect((await get(handle.port, "/api/log/Other/o1?tail=1")).status).toBe(
      404,
    );
    expect((await get(handle.port, "/api/log/Other/o1?full=1")).status).toBe(
      404,
    );
  });

  test("a full export returns the entire file, not the tail; carries attachment and Content-Length", async () => {
    const root = await mkdtemp(join(tmpdir(), "wave-status-full-"));
    roots.push(root);
    await mkdir(join(root, "waveT"));
    await nameLanes(join(root, "waveT"), "T", ["t1", "t2"]);
    // 32 KB payload is larger than the default 16 KB tail
    const payload = Buffer.concat([
      Buffer.alloc(32_000, 0x61),
      Buffer.from("FULL_EXPORT_END\n"),
    ]);
    const logPath = join(root, "waveT", "t1.log");
    await writeFile(logPath, payload);

    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/api/log/T/t1?full=1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="T-t1.log"',
    );
    expect(res.headers["content-length"]).toBe(String(payload.length));
    expect(res.body.length).toBe(payload.length);
    expect(res.body.equals(payload)).toBe(true);
  });

  test("full=1 and tail=N together: full wins and tail is ignored", async () => {
    const root = await mkdtemp(join(tmpdir(), "wave-status-full-wins-"));
    roots.push(root);
    await mkdir(join(root, "waveT"));
    await nameLanes(join(root, "waveT"), "T", ["t1", "t2"]);
    const payload = Buffer.concat([
      Buffer.alloc(32_000, 0x62),
      Buffer.from("FULL_WINS_END\n"),
    ]);
    await writeFile(join(root, "waveT", "t1.log"), payload);

    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    const res = await get(handle.port, "/api/log/T/t1?full=1&tail=1");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="T-t1.log"',
    );
    expect(res.headers["content-length"]).toBe(String(payload.length));
    expect(res.body.length).toBe(payload.length);
    expect(res.body.equals(payload)).toBe(true);
  });

  test("full=0 and full=yes behave exactly as if full were absent", async () => {
    const root = await makeFixture();
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    const baseline = await get(handle.port, "/api/log/T/t1?tail=1");
    const full0 = await get(handle.port, "/api/log/T/t1?full=0&tail=1");
    const fullYes = await get(handle.port, "/api/log/T/t1?full=yes&tail=1");

    expect(full0.status).toBe(200);
    expect(full0.headers["content-disposition"]).toBeUndefined();
    expect(full0.body.equals(baseline.body)).toBe(true);

    expect(fullYes.status).toBe(200);
    expect(fullYes.headers["content-disposition"]).toBeUndefined();
    expect(fullYes.body.equals(baseline.body)).toBe(true);

    const defaultBaseline = await get(handle.port, "/api/log/U/u2");
    const defaultFull0 = await get(handle.port, "/api/log/U/u2?full=0");
    const defaultFullYes = await get(handle.port, "/api/log/U/u2?full=yes");
    expect(defaultFull0.status).toBe(200);
    expect(defaultFull0.headers["content-disposition"]).toBeUndefined();
    expect(defaultFull0.body.equals(defaultBaseline.body)).toBe(true);
    expect(defaultFullYes.status).toBe(200);
    expect(defaultFullYes.headers["content-disposition"]).toBeUndefined();
    expect(defaultFullYes.body.equals(defaultBaseline.body)).toBe(true);
  });

  test("full export of a missing lane is 404", async () => {
    const root = await makeFixture();
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    expect((await get(handle.port, "/api/log/T/missing?full=1")).status).toBe(
      404,
    );
    expect((await get(handle.port, "/api/log/ZZ/zz?full=1")).status).toBe(404);
  });

  test("a read that fails after the headers are sent leaves the server still answering the next request", async () => {
    const root = await mkdtemp(join(tmpdir(), "wave-status-stream-error-"));
    roots.push(root);
    await mkdir(join(root, "waveT"));
    await nameLanes(join(root, "waveT"), "T", ["t1", "t2"]);
    // A directory at t1.log stats successfully (so 200 headers are sent),
    // but reading it as a stream fails asynchronously with EISDIR.
    await mkdir(join(root, "waveT", "t1.log"));
    await writeFile(join(root, "waveT", "t2.log"), "survived\n");

    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });

    await expect(get(handle.port, "/api/log/T/t1?full=1")).rejects.toThrow();

    const res = await get(handle.port, "/api/log/T/t2?full=1");
    expect(res.status).toBe(200);
    expect(res.body.toString("utf8")).toBe("survived\n");
  });

  test("a log smaller than the tail, a missing tail param and a bad tail param all work", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => statusAt(0),
    });
    expect(
      (await get(handle.port, "/api/log/U/u2?tail=16")).body.toString("utf8"),
    ).toBe("short\n");
    expect(
      (await get(handle.port, "/api/log/U/u2")).body.toString("utf8"),
    ).toBe("short\n");
    expect(
      (await get(handle.port, "/api/log/U/u2?tail=abc")).body.toString("utf8"),
    ).toBe("short\n");
    expect(
      (await get(handle.port, "/api/log/U/u2?tail=0")).body.toString("utf8"),
    ).toBe("short\n");
  });

  test("unknown waves, missing logs and an unreadable root are 404", async () => {
    const root = await makeFixture();
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
    });
    expect((await get(handle.port, "/api/log/ZZ/zz")).status).toBe(404);
    expect((await get(handle.port, "/api/log/T/missing")).status).toBe(404);
    const dead = await start({
      port: 0,
      scanRoot: join(root, "does-not-exist"),
      collect: async () => statusAt(0),
    });
    expect((await get(dead.port, "/api/log/T/t1")).status).toBe(404);
  });

  test("the default collection wires the real deps against the scan root", async () => {
    const root = await makeFixture();
    const handle = await start({ port: 0, scanRoot: root });
    const res = await get(handle.port, "/api/status");
    expect(res.status).toBe(200);
    const status = JSON.parse(res.body.toString("utf8")) as WaveStatus;
    expect(status.waves.map((wave) => wave.id)).toEqual(["T", "U"]);
    const t1 = status.waves[0]?.lanes[0];
    expect(t1?.derived.log?.bytes).toBe(4104);
    expect(t1?.derived.gate?.exit).toBe(0);
    expect(t1?.derived.alive).toBe(false);
    expect(t1?.derived.pr).toBeUndefined();
    expect(t1?.reported).toMatchObject({ stage: "gate" });
  });

  test("/api/stream sends a status event on connect and pushes when the injected watcher fires", async () => {
    const root = await makeFixture();
    let version = 0;
    const listeners: Array<() => void> = [];
    // A poll that never fires inside the test: the only path to a second event
    // is the injected watcher callback — no filesystem, no race.
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(version),
      pollMs: 3_600_000,
      watch: (_path, listener) => {
        listeners.push(listener);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });

    const { reader, response } = await openStream(handle.port);
    try {
      expect(response.headers["content-type"]).toContain("text/event-stream");

      expect(await reader.waitFor(1)).toEqual([JSON.stringify(statusAt(0))]);
      await reader.expectQuiet(200);

      version = 1;
      listeners[0]?.();
      expect(await reader.waitFor(2)).toEqual([
        JSON.stringify(statusAt(0)),
        JSON.stringify(statusAt(1)),
      ]);
    } finally {
      response.destroy();
    }
  });

  // Platform watchers are load-sensitive; the injected-watcher test is the
  // contract; run with WAVE_STATUS_REAL_WATCH=1 to smoke a real watcher.
  /* eslint-disable turbo/no-undeclared-env-vars -- WAVE_STATUS_REAL_WATCH is a test-runner opt-in, not a turbo pipeline input. */
  test.skipIf(process.env.WAVE_STATUS_REAL_WATCH !== "1")(
    "fs.watch on a real lane log pushes a status event (smoke)",
    async () => {
      const root = await makeFixture();
      let version = 0;
      const handle = await start({
        port: 0,
        scanRoot: root,
        collect: async () => statusAt(version),
        pollMs: 3_600_000,
        watch: (path, listener) => fsWatch(path, listener),
      });

      const { reader, response } = await openStream(handle.port);
      try {
        expect(await reader.waitFor(1)).toEqual([JSON.stringify(statusAt(0))]);
        version = 1;
        await appendFile(join(root, "waveT", "t1.log"), "changed\n");
        expect(await reader.waitFor(2, 10_000)).toEqual([
          JSON.stringify(statusAt(0)),
          JSON.stringify(statusAt(1)),
        ]);
      } finally {
        response.destroy();
      }
    },
    15_000,
  );

  /**
   * The watchers are armed on the lane files themselves, never on the
   * wave directories. On macOS a directory `fs.watch` is FSEvents-backed, and
   * its native `close()` flushes the watcher's pending event batch
   * synchronously — measured at 2–9 s with `fseventsd` backlogged by a full
   * suite, which is what pushed `close()` past the runner's patience. A file
   * watcher is kqueue-backed and its `close()` is instant.
   */
  test("the watchers are armed on lane files, never on the wave directories", async () => {
    const root = await makeFixture();
    await writeFile(join(root, "waveT", "notes.txt"), "not a lane log\n");
    const armed: string[] = [];
    await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 3_600_000,
      watch: (path) => {
        armed.push(path);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });
    expect(armed.slice().sort()).toEqual(
      [
        join(root, "waveT", "events.jsonl"),
        join(root, "waveT", "gate-t1.log"),
        join(root, "waveT", "t1.log"),
        join(root, "waveU", "events.jsonl"),
        join(root, "waveU", "u2.log"),
      ].sort(),
    );
  });

  test("a lane log created after startup is armed once by the next poll tick", async () => {
    const root = await makeFixture();
    const armed: string[] = [];
    await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 20,
      watch: (path) => {
        armed.push(path);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });
    const created = join(root, "waveT", "t2.log");
    await writeFile(created, "new lane\n");
    const deadline = Date.now() + 2_000;
    while (!armed.includes(created)) {
      if (Date.now() > deadline) {
        throw new Error(
          `the new lane log was never armed; have ${armed.join(", ")}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Every tick re-lists the wave dirs; an already-watched path is never armed twice.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(armed.filter((path) => path === created)).toHaveLength(1);
  });

  test("a wave directory that vanishes mid-listing is skipped without losing the poll", async () => {
    const root = await makeFixture();
    const armed: string[] = [];
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 20,
      deps: {
        ...realDepsFor(REPO_ROOT),
        readdir: async (dir) => {
          if (dir === join(root, "waveU"))
            throw new Error("ENOENT: gone mid-listing");
          return realDepsFor(REPO_ROOT).readdir(dir);
        },
      },
      watch: (path) => {
        armed.push(path);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });
    // The throw must stay inside the per-directory listing: the server starts,
    // the other wave dir arms normally, and the tick after it still runs.
    expect(armed).toContain(join(root, "waveT", "t1.log"));
    expect(armed).not.toContain(join(root, "waveU", "u2.log"));
    const before = armed.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(armed.length).toBe(before);
    await handle.close();
    handles.pop();
  });

  test("a syncWatchers in flight when close() runs arms no watcher afterwards", async () => {
    const root = await makeFixture();
    let hang = false;
    let inListing = 0;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const armed: string[] = [];
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 20,
      deps: {
        ...realDepsFor(REPO_ROOT),
        readdir: async (dir) => {
          if (hang) {
            inListing += 1;
            await gate;
          }
          return realDepsFor(REPO_ROOT).readdir(dir);
        },
      },
      watch: (path) => {
        armed.push(path);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });
    try {
      hang = true;
      const deadline = Date.now() + 2_000;
      while (inListing === 0) {
        if (Date.now() > deadline) {
          throw new Error(
            "syncWatchers never read the listing through deps.readdir",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const armedAtClose = armed.length;
      await handle.close();
      handles.pop();
      // A lane log that appears while a listing is parked must still not be
      // armed after the close: create it before releasing the parked readdir.
      const late = join(root, "waveU", "u3.log");
      await writeFile(late, "too late\n");
      release();
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(armed).not.toContain(late);
      expect(armed.length).toBe(armedAtClose);
    } finally {
      release();
    }
  });

  test("a refresh queued behind an in-flight one does not run after close()", async () => {
    const root = await makeFixture();
    let blocked = false;
    let release = (): void => undefined;
    let gate = Promise.resolve();
    const collect = vi.fn(async () => {
      if (blocked) await gate;
      return statusAt(0);
    });
    const listeners: Array<(eventType?: string) => void> = [];
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect,
      pollMs: 3_600_000,
      watch: (_path, listener) => {
        listeners.push(listener);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });
    // The startup collection is the first; `start()` awaits it before returning.
    const atStart = collect.mock.calls.length;
    expect(atStart).toBe(1);

    // Put one refresh in flight, then queue a second behind it in the same tick.
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    blocked = true;
    listeners[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    listeners[1]?.();
    expect(collect.mock.calls.length).toBe(atStart + 1);

    // Close while the first is still in flight; the queued one must never run.
    await handle.close();
    handles.pop();
    release();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(collect.mock.calls.length).toBe(atStart + 1);
  });

  test("a watcher emitting error is caught and its path is re-armed on the next tick", async () => {
    const root = await makeFixture();
    const target = join(root, "waveT", "t1.log");
    const armed: string[] = [];
    const errors: Array<() => void> = [];
    const closed: string[] = [];
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 20,
      watch: (path, _listener, onError) => {
        if (path === target) {
          armed.push(path);
          errors.push(onError);
          return { close: () => closed.push(path) };
        }
        return {
          close(): void {
            /* the other lanes are not the subject here */
          },
        };
      },
    });
    expect(armed).toEqual([target]);
    const index = armed.indexOf(target);

    // An `error` event with no listener throws out of the EventEmitter; the
    // server must absorb it and drop this watcher rather than fall over.
    expect(() => errors[index]?.()).not.toThrow();
    expect(closed).toContain(target);

    // The path was forgotten, so the next poll tick re-arms the current file.
    const deadline = Date.now() + 2_000;
    while (armed.filter((path) => path === target).length < 2) {
      if (Date.now() > deadline) {
        throw new Error(
          `the errored watcher never re-armed ${target}; armed ${armed.length}x`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await handle.close();
    handles.pop();
  });

  test("a watch that throws for one file still arms the others and retries it next tick", async () => {
    const root = await makeFixture();
    const vanishing = join(root, "waveT", "gate-t1.log");
    const armed: string[] = [];
    let throwOnce = true;
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 20,
      watch: (path) => {
        if (path === vanishing && throwOnce) {
          throwOnce = false;
          throw new Error(`ENOENT: ${path} vanished between readdir and watch`);
        }
        armed.push(path);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });
    // One vanished watch must not abort the tick: every other lane file armed.
    expect(armed).toContain(join(root, "waveT", "t1.log"));
    expect(armed).toContain(join(root, "waveT", "events.jsonl"));
    expect(armed).toContain(join(root, "waveU", "u2.log"));
    // The failing path is not marked watched, so it is not silently skipped.
    expect(armed).not.toContain(vanishing);

    // A later tick (the throw is spent now) re-lists and arms the vanished file.
    const deadline = Date.now() + 2_000;
    while (!armed.includes(vanishing)) {
      if (Date.now() > deadline) {
        throw new Error(
          `the vanished file was never retried; have ${armed.join(", ")}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await handle.close();
    handles.pop();
  });

  test("a watcher that reports rename is closed and its path is re-armed next tick", async () => {
    const root = await makeFixture();
    const target = join(root, "waveT", "t1.log");
    const armed: string[] = [];
    const closed: string[] = [];
    const changes = new Map<string, (eventType?: string) => void>();
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => statusAt(0),
      pollMs: 20,
      watch: (path, listener) => {
        armed.push(path);
        changes.set(path, listener);
        return { close: () => closed.push(path) };
      },
    });
    expect(armed.filter((path) => path === target)).toHaveLength(1);

    // The lane log is replaced at the same path (a new inode): the watcher
    // reports `rename`, so the dead watcher is closed and the path forgotten.
    changes.get(target)?.("rename");
    expect(closed).toContain(target);

    // The path was forgotten, so the next poll tick arms the current file.
    const deadline = Date.now() + 2_000;
    while (armed.filter((path) => path === target).length < 2) {
      if (Date.now() > deadline) {
        throw new Error(
          `rename never re-armed ${target}; armed ${armed.length}x`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await handle.close();
    handles.pop();
  });

  test("overlapping watch ticks still push the latest status", async () => {
    const root = await makeFixture();
    let version = 0;
    let blocked = false;
    let release = (): void => undefined;
    let gate = Promise.resolve();
    const listeners: Array<() => void> = [];

    const handle = await start({
      port: 0,
      scanRoot: root,
      collect: async () => {
        const snapshot = version;
        if (blocked) await gate;
        return statusAt(snapshot);
      },
      pollMs: 3_600_000,
      watch: (_path, listener) => {
        listeners.push(listener);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });

    const { reader, response } = await openStream(handle.port);
    try {
      expect(await reader.waitFor(1)).toEqual([JSON.stringify(statusAt(0))]);

      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      blocked = true;
      version = 1;
      listeners[0]?.();
      version = 2;
      listeners[0]?.();
      release();

      expect(await reader.waitFor(3, 2_000)).toEqual([
        JSON.stringify(statusAt(0)),
        JSON.stringify(statusAt(1)),
        JSON.stringify(statusAt(2)),
      ]);
    } finally {
      response.destroy();
    }
  });

  test("after startup, a watch-triggered refresh calls gh zero times; the poll tick calls it once", async () => {
    const root = await makeFixture();
    const gh = vi.fn(async () => "[]");
    const listeners: Array<() => void> = [];
    await start({
      port: 0,
      scanRoot: root,
      pollMs: 200,
      deps: fixtureDeps({ gh }),
      watch: (_path, listener) => {
        listeners.push(listener);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });

    const afterStart = gh.mock.calls.length;
    expect(afterStart).toBe(1);

    listeners[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(gh.mock.calls.length).toBe(afterStart);

    const deadline = Date.now() + 2_000;
    while (gh.mock.calls.length < afterStart + 1) {
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for the poll tick to call gh; have ${gh.mock.calls.length}, want ${afterStart + 1}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(gh.mock.calls.length).toBe(afterStart + 1);
  });

  test("a poll tick queued behind a watch still refreshes PR facts", async () => {
    const root = await makeFixture();
    const gh = vi.fn(async () => "[]");
    let hang = false;
    let gate = Promise.resolve();
    let release = (): void => undefined;
    const listeners: Array<() => void> = [];
    await start({
      port: 0,
      scanRoot: root,
      pollMs: 80,
      deps: fixtureDeps({
        gh,
        readdir: async (dir) => {
          if (hang) await gate;
          return realDepsFor(REPO_ROOT).readdir(dir);
        },
      }),
      watch: (_path, listener) => {
        listeners.push(listener);
        return {
          close(): void {
            /* the test owns the lifetime */
          },
        };
      },
    });

    expect(gh.mock.calls.length).toBe(1);
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    hang = true;
    listeners[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(gh.mock.calls.length).toBe(1);
    release();
    const deadline = Date.now() + 2_000;
    while (gh.mock.calls.length < 2) {
      if (Date.now() > deadline) {
        throw new Error(
          `poll queued behind watch never called gh; have ${gh.mock.calls.length}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(gh.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("/api/stream stays quiet while nothing changed, publishes a failure once, then the poll pushes", async () => {
    let version = 0;
    let failing = false;
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => {
        if (failing) throw new Error("gh is down");
        return statusAt(version);
      },
      pollMs: 40,
    });

    const { reader, response } = await openStream(handle.port);
    try {
      expect(await reader.waitFor(1)).toEqual([JSON.stringify(statusAt(0))]);

      // Unchanged data on the poll tick is not a change. A failure IS: it is
      // published once, and then a poll that fails the same way is not a change
      // either, so the stream does not repeat itself every 40 ms.
      await reader.expectQuiet(200);
      failing = true;
      const events = await reader.waitFor(2);
      expect(JSON.parse(events[1] ?? "{}")).toMatchObject({
        waves: [],
        error: "gh is down",
      });
      await reader.expectQuiet(200);
      failing = false;

      // The slow poll exists for gh-only changes — no file was touched here.
      version = 1;
      expect(await reader.waitFor(3)).toEqual([
        JSON.stringify(statusAt(0)),
        events[1],
        JSON.stringify(statusAt(1)),
      ]);
    } finally {
      response.destroy();
    }
  });
});

/**
 * SURFACE, DO NOT MASK. The source caught a failed collection in two places and
 * did the opposite of saying so: the watcher kept serving the last good
 * snapshot, and `/api/status` answered a bare 500 with the body "internal
 * error". Both are the same lie — a reader looking at rows believes them, and a
 * reader looking at the status code has to guess which step failed. One body,
 * both faces: HTTP 200, `{waves: [], generatedAt, error}`.
 */
describe("a failed collection", () => {
  const RISK_PLAN = [
    "# The plan",
    "",
    "| Lane | Risk | Delivers |",
    "|---|---|---|",
    // A plain `high`, not `**high**`. The risk reader refuses it loudly rather
    // than reading it as low-stakes, and that refusal is what a collection
    // surfaces here.
    "| **PZ1** | high | Split the reserved list. |",
  ].join("\n");

  /** A scan root and a plan directory whose row for lane PZ1 is malformed. */
  async function makeRiskFixture(): Promise<{
    readonly scanRoot: string;
    readonly deps: CollectDeps;
  }> {
    const scanRoot = await mkdtemp(join(tmpdir(), "wave-status-risk-"));
    const planningDir = await mkdtemp(join(tmpdir(), "wave-status-plans-"));
    roots.push(scanRoot, planningDir);
    await mkdir(join(scanRoot, "waveR"));
    await writeFile(
      join(scanRoot, "waveR", "events.jsonl"),
      `${JSON.stringify({
        ts: "2026-09-28T09:00:00Z",
        wave: "R",
        lane: "PZ1",
        stage: "implement",
        event: "started",
      })}\n`,
    );
    await writeFile(join(scanRoot, "waveR", "PZ1.log"), "building\n");
    await writeFile(join(planningDir, "plan.md"), RISK_PLAN);
    return {
      scanRoot,
      deps: {
        ...realDepsFor(REPO_ROOT),
        repo: REPO,
        planningDir,
        pgrep: async () => 0,
        gh: async () => "[]",
        git: async () => "",
      },
    };
  }

  test("/api/status answers 200 with the reason, naming the row, and with no waves", async () => {
    const { scanRoot, deps } = await makeRiskFixture();
    const handle = await start({ port: 0, scanRoot, deps });
    const res = await get(handle.port, "/api/status", "GET", 5_000);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body.toString("utf8")) as {
      waves: unknown[];
      generatedAt: string;
      error?: string;
    };
    expect(body.generatedAt).toEqual(expect.any(String));
    // The row that could not be read is named, so the operator knows which line
    // of which plan to open.
    expect(body.error).toContain("PZ1");
    expect(body.error).toContain("plan.md");
    // And no waves: a lane row beside a failure that says the read did not
    // happen is a row about a state nobody can vouch for.
    expect(body.waves).toEqual([]);
  });

  test("an SSE client that connects AFTER the failure gets the same body", async () => {
    const { scanRoot, deps } = await makeRiskFixture();
    const handle = await start({ port: 0, scanRoot, deps, pollMs: 3_600_000 });
    // The startup collection already failed, so the failure is what this client
    // should be handed on connect — not the empty lastJson of a silent server.
    const { reader, response } = await openStream(handle.port);
    try {
      const [first] = await reader.waitFor(1);
      const body = JSON.parse(first ?? "{}") as {
        waves: unknown[];
        error?: string;
      };
      expect(body.error).toContain("PZ1");
      expect(body.waves).toEqual([]);
      await reader.expectQuiet(200);
    } finally {
      response.destroy();
    }
  });

  test("a live SSE client is pushed the failure, and a later good collect omits an error", async () => {
    let failing = false;
    const listeners: Array<() => void> = [];
    const version = 1;
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      pollMs: 3_600_000,
      watch: (_path, listener) => {
        listeners.push(listener as () => void);
        return { close: (): void => undefined };
      },
      collect: async () => {
        if (failing) throw new Error("could not fetch PRs: gh: no auth");
        return statusAt(version);
      },
    });

    const { reader, response } = await openStream(handle.port);
    try {
      // Startup succeeded, so the first event is the good snapshot.
      expect(await reader.waitFor(1)).toEqual([JSON.stringify(statusAt(1))]);

      failing = true;
      listeners[0]?.();
      const events = await reader.waitFor(2);
      const failure = JSON.parse(events[1] ?? "{}") as {
        waves: unknown[];
        error?: string;
      };
      expect(failure.error).toBe("could not fetch PRs: gh: no auth");
      // The waves from the snapshot above are GONE, not carried beside the error.
      expect(failure.waves).toEqual([]);

      // And a client that connects now is handed the failure too.
      const late = await openStream(handle.port);
      try {
        const [first] = await late.reader.waitFor(1);
        expect((JSON.parse(first ?? "{}") as { error?: string }).error).toBe(
          "could not fetch PRs: gh: no auth",
        );
      } finally {
        late.response.destroy();
      }

      // Recovery: the next good collection publishes without `error`, so the
      // two states are distinguishable from the payload alone.
      failing = false;
      listeners[0]?.();
      const after = await reader.waitFor(3);
      expect(JSON.parse(after[2] ?? "{}")).toEqual(statusAt(1));
    } finally {
      response.destroy();
    }
  });

  test("a thrown non-Error is surfaced by its own text, never as [object Object]", async () => {
    const handle = await start({
      port: 0,
      scanRoot: await makeFixture(),
      collect: async () => {
        throw "log file vanished";
      },
    });
    const res = await get(handle.port, "/api/status", "GET", 5_000);
    const body = JSON.parse(res.body.toString("utf8")) as { error?: string };
    expect(body.error).toBe("log file vanished");
  });
});

describe("cleanup", () => {
  test("listen rejects when the requested port is already bound", async () => {
    const root = await makeFixture();
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen({ port: 0, host: "127.0.0.1", exclusive: true }, () =>
        resolve(),
      );
    });
    const port = (blocker.address() as { port: number }).port;
    const watcherClose = vi.fn();

    try {
      await expect(
        startServer({
          port,
          repoRoot: REPO_ROOT,
          config: config(),
          scanRoot: root,
          collect: async () => statusAt(0),
          watch: () => ({ close: watcherClose }),
        }),
      ).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
      expect(watcherClose).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    }
  });

  test("close() shuts the server, its watchers and its interval down", async () => {
    const root = await makeFixture();
    const collect = vi.fn(async () => statusAt(0));
    const closedWatchers = new Set<string>();
    const listeners: Array<() => void> = [];
    const handle = await start({
      port: 0,
      scanRoot: root,
      collect,
      pollMs: 20,
      watch: (path, listener) => {
        listeners.push(listener);
        return { close: () => closedWatchers.add(path) };
      },
    });
    const port = handle.port;
    // The contract the cleanup promises runs against real watchers: a directory
    // fs.watch whose close() flushes a pending batch is what hung this test
    // hang behind it, so here the arming itself is asserted through the injected seam.
    expect(listeners.length).toBe(5);

    await handle.close();
    handles.pop();

    expect([...closedWatchers].sort()).toEqual(
      [
        join(root, "waveT", "events.jsonl"),
        join(root, "waveT", "gate-t1.log"),
        join(root, "waveT", "t1.log"),
        join(root, "waveU", "events.jsonl"),
        join(root, "waveU", "u2.log"),
      ].sort(),
    );
    // Nothing runs after close(): neither a watcher event queued in the same
    // tick nor the poll interval may start another collection.
    const collectionsAtClose = collect.mock.calls.length;
    for (const notify of listeners) notify();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(collect.mock.calls.length).toBe(collectionsAtClose);

    await expect(
      new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, path: "/api/status" },
          (res) => {
            res.resume();
            resolve();
          },
        );
        req.on("error", () =>
          reject(new Error("connection refused — server is closed")),
        );
        req.end();
      }),
    ).rejects.toThrow("connection refused — server is closed");
  });
});
