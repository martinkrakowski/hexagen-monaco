import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createReadStream, watch as fsWatch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collect,
  MAX_TAIL_KB,
  readTail,
  realDepsFor,
  resolveScanRoots,
  waveIdFromDirName,
  type CollectDeps,
  type PrCorpus,
  type StatusBody,
  type TailHandle,
} from "./lib/collect.js";
import { errorText } from "../internal/artifact.js";
import { DEFAULT_WAVE_STATUS_PORT, type Config } from "../internal/config.js";
import { waveStatusPageUrl } from "../internal/package-paths.js";
import type { WaveStatus } from "../internal/wave-types.js";

const DEFAULT_TAIL_KB = 16;
const DEFAULT_POLL_MS = 15_000;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * The port comes from the project's overlay, and only from there.
 *
 * `config.waveStatusPort` is the project's own setting; `PORT` is the operator's
 * standing override for one run. A port the file listed in `forbiddenPorts` is
 * refused BY NAME, whatever asked for it — a packaged tool cannot know which
 * ports a given machine already spends on its own development servers, so the
 * project says which, and this module only enforces it.
 *
 * DEVIATION from the source: an EMPTY `PORT` (`PORT=""`) now means "unset" and
 * the configured port stands, where the source read it as `Number("")`, which is
 * 0, an ephemeral port. A shell that exports an empty `PORT` is far more often
 * "not set" than "give me any port", and the file's own port is the answer that
 * matches what the operator wrote. (`PORT=0` still asks for an ephemeral port.)
 *
 * The source carried a different answer twice: one project's port as the
 * default, and a hardcoded pair of "reserved for the operator's dev servers"
 * that fired whatever the file said. Both are that project's facts, not this
 * package's.
 */
export function resolvePort(
  env: { readonly PORT?: string },
  config: Pick<Config, "waveStatusPort" | "forbiddenPorts"> = {
    waveStatusPort: DEFAULT_WAVE_STATUS_PORT,
    forbiddenPorts: [],
  },
): number {
  const raw = env.PORT;
  const port =
    raw === undefined || raw === "" ? config.waveStatusPort : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `invalid PORT: ${JSON.stringify(raw ?? config.waveStatusPort)}`,
    );
  }
  if (config.forbiddenPorts.includes(port)) {
    throw new Error(
      `refusing to bind port ${port}: it is listed in forbiddenPorts. ` +
        `Remove it from forbiddenPorts in .agents/orchestration/config.yaml, or set PORT to another port.`,
    );
  }
  return port;
}

/**
 * The built-in design tokens, served when the project set no `tokensCssPath`.
 *
 * The page consumes `--color-*` and never declares them, so `/tokens.css` has to
 * answer with something. This is that something: a deliberately NEUTRAL set,
 * greyscale in the light block and a dark block of near-blacks, because a
 * packaged tool must not ship one project's brand palette. Every tone here is a
 * different step of the same grey, so the pills still RANK — and each pill
 * states its state as a word, which is what actually names it, exactly as when
 * the project supplies its own file.
 *
 * A project that wants its own palette sets `tokensCssPath`, and the file named
 * there is served instead (`:root` as a base, `.dark` after it).
 */
export const BUILTIN_TOKENS_CSS = `:root {
  color-scheme: light;
  --color-background: #ffffff;
  --color-surface: #f6f6f6;
  --color-surface-2: #ebebeb;
  --color-border: #d2d2d2;
  --color-border-control: #d2d2d2;
  --color-border-control-hover: #7a7a7a;
  --color-text-primary: #1c1c1c;
  --color-text-secondary: #4a4a4a;
  --color-text-muted: #6f6f6f;
  --color-text-emphasis: #000000;
  --color-brand-primary: #333333;
  --color-brand-tint: #e4e4e4;
  --color-error: #1a1a1a;
  --color-warning: #3d3d3d;
  --color-success: #616161;
  --color-info: #8c8c8c;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --font-sans: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --radius-sm: 4px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
}

.dark {
  color-scheme: dark;
  --color-background: #101010;
  --color-surface: #1a1a1a;
  --color-surface-2: #262626;
  --color-border: #3a3a3a;
  --color-border-control: #3a3a3a;
  --color-border-control-hover: #8a8a8a;
  --color-text-primary: #e8e8e8;
  --color-text-secondary: #bdbdbd;
  --color-text-muted: #949494;
  --color-text-emphasis: #ffffff;
  --color-brand-primary: #cfcfcf;
  --color-brand-tint: #2b2b2b;
  --color-error: #f2f2f2;
  --color-warning: #b4b4b4;
  --color-success: #7d7d7d;
  --color-info: #4f4f4f;
}
`;

export type Route =
  | { readonly kind: "index" }
  | { readonly kind: "status" }
  | { readonly kind: "stream" }
  | { readonly kind: "tokens" }
  | {
      readonly kind: "log";
      readonly wave: string;
      readonly lane: string;
      readonly search: URLSearchParams;
    }
  | { readonly kind: "notFound" };

/**
 * The whole route table, as data so a test can enumerate it: these are the only
 * routes, all GET, none mutating. Path segments are validated so a crafted lane
 * name cannot climb out of the wave log root.
 */
export function routeFor(
  method: string | undefined,
  url: string | undefined,
): Route | "methodNotAllowed" {
  if (method !== "GET") return "methodNotAllowed";
  let parsed: URL;
  try {
    parsed = new URL(url ?? "/", "http://127.0.0.1");
  } catch {
    return { kind: "notFound" };
  }
  const path = parsed.pathname;
  if (path === "/") return { kind: "index" };
  if (path === "/api/status") return { kind: "status" };
  if (path === "/api/stream") return { kind: "stream" };
  if (path === "/tokens.css") return { kind: "tokens" };
  const log = /^\/api\/log\/([^/]+)\/([^/]+)$/.exec(path);
  if (log !== null && SEGMENT.test(log[1]) && SEGMENT.test(log[2])) {
    return {
      kind: "log",
      wave: log[1],
      lane: log[2],
      search: parsed.searchParams,
    };
  }
  return { kind: "notFound" };
}

export type WatchFn = (
  path: string,
  listener: (eventType?: string) => void,
  onError: () => void,
) => Pick<FSWatcher, "close">;

export interface StartOptions {
  readonly port: number;
  /** The REPOSITORY root, as `loadConfigFor` resolved it. */
  readonly repoRoot: string;
  /** The project's overlay. The port, the plan directory and the tokens file all come from it. */
  readonly config: Config;
  /** The WAVE LOG ROOT to scan — the per-repository root, never a shared directory. */
  readonly scanRoot: string;
  /** Collection is injected so tests never shell out to `gh`. */
  readonly collect?: (now: string) => Promise<WaveStatus>;
  /**
   * Process-facing deps for the default collector and for log tails. Tests
   * inject `gh` (and wrap `open`) here; `collect` still wins when set.
   */
  readonly deps?: CollectDeps;
  /** The slow poll that catches `gh`-only changes and new lane files; `fs.watch` covers writes to the rest. */
  readonly pollMs?: number;
  /** Overridable so tests can point at a missing page. */
  readonly indexHtmlPath?: string;
  /**
   * Overridable so tests can point at a missing or malformed tokens file, and
   * to make a silent fallback the mutation that this lane's tests catch.
   */
  readonly tokensCssPath?: string;
  /** Overridable so tests can wrap `fs.watch` without stubbing the whole module. */
  readonly watch?: WatchFn;
}

export interface ServerHandle {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

/**
 * The process-facing deps the default collector runs with, built from the
 * repository root and the overlay: the plan directory the pre-PR-review gate
 * greps, the repository every `gh` path addresses, and the wave log root the
 * plan-verify artifact lives under.
 */
export function defaultDeps(repoRoot: string, config: Config): CollectDeps {
  const repo = config.repo;
  if (repo === undefined) {
    throw new Error(
      "wave-status cannot collect: no repository is configured. Set `repo` in " +
        ".agents/orchestration/config.yaml (or run `hexagen-orchestration-doctor`).",
    );
  }
  return {
    ...realDepsFor(repoRoot),
    repo,
    planningDir: resolve(repoRoot, config.planDir),
    ...(config.waveLogDir !== undefined
      ? { waveLogDir: config.waveLogDir }
      : {}),
  };
}

/**
 * The body a failed collection publishes. The failure is a fact about the READ,
 * never about the waves, so it carries no waves: serving the last good snapshot
 * beside a new error would let a reader believe lanes that have since changed,
 * and returning a bare 500 would hide the reason behind a status code nobody
 * looks at. HTTP stays 200 — the request succeeded; what it reports is the
 * failure.
 */
function failedBody(thrown: unknown, generatedAt: string): StatusBody {
  return { waves: [], generatedAt, error: errorText(thrown) };
}

/**
 * The read-only status server: it starts nothing, kills nothing and merges
 * nothing. SSE clients get one `status` event on connect and another whenever
 * the collected status actually changes — a failure included.
 */
export async function startServer(
  options: StartOptions,
): Promise<ServerHandle> {
  const deps = options.deps ?? defaultDeps(options.repoRoot, options.config);
  const indexHtmlPath =
    options.indexHtmlPath ?? fileURLToPath(waveStatusPageUrl(import.meta.url));
  // The page's own stylesheet is only ever served, never read off this machine:
  // the file is the project's, and it lives wherever the project put it. A
  // relative `tokensCssPath` resolves from the repository root, so an operator
  // running the bin from a subdirectory gets the same file.
  const tokensCssPath =
    options.tokensCssPath ??
    (options.config.tokensCssPath === undefined
      ? undefined
      : resolve(options.repoRoot, options.config.tokensCssPath));
  const watchPath: WatchFn =
    options.watch ??
    ((path, listener, onError) => {
      // A bare `fsWatch(path, listener)` is the crash this comment exists for:
      // an `FSWatcher` is an `EventEmitter`, and when the file it watches is
      // deleted it can emit `error` — which with no listener throws and takes
      // the status server down. Lane logs are deleted and recreated routinely,
      // so wire one.
      const watcher = fsWatch(path, listener);
      watcher.on("error", onError);
      return watcher;
    });

  const clients = new Set<ServerResponse>();
  // A file watcher is armed once per path and dropped the moment that path is
  // removed or replaced, so the same inode is never watched twice and a vanished
  // file is re-armed by the next poll tick. `watched` is the arming ledger.
  const watched = new Map<string, Pick<FSWatcher, "close">>();
  let lastJson = "";
  let lastComparable: string | undefined;
  let refreshRunning = false;
  let refreshQueued = false;
  let queuedRefreshPr = false;
  let closed = false;
  let prCache: PrCorpus | undefined;

  /**
   * Startup, the 15 s poll, and on-demand `/api/status` refresh PR facts.
   * A watcher-triggered refresh reuses `prCache` and re-reads local state only.
   * `collect` fetches and returns the corpus itself — it is the only caller that
   * has seen the lanes the fetch is scoped to — and hands it back here to
   * cache for the next watcher refresh, gap included: a cached corpus is
   * exactly as complete as the read it came from.
   */
  const collectNow = async (refreshPr: boolean): Promise<WaveStatus> => {
    const now = new Date().toISOString();
    if (options.collect !== undefined) return options.collect(now);
    if (refreshPr) {
      return collect(deps, options.scanRoot, now, undefined, (corpus) => {
        prCache = corpus;
      });
    }
    return collect(deps, options.scanRoot, now, prCache);
  };

  /** Publish a body to every SSE client, if it is a change. */
  const publish = (body: StatusBody): void => {
    const json = JSON.stringify(body);
    // generatedAt changes on every collection; it is not a change.
    const comparable = JSON.stringify({ ...body, generatedAt: "" });
    if (comparable === lastComparable) return;
    lastComparable = comparable;
    lastJson = json;
    for (const client of clients)
      client.write(`event: status\ndata: ${json}\n\n`);
  };

  const refresh = async (refreshPr: boolean): Promise<void> => {
    try {
      publish(await collectNow(refreshPr));
    } catch (thrown) {
      // SURFACE, DO NOT MASK. A collection that failed is published as itself:
      // the reason, the moment it happened, and no waves. The last good
      // snapshot is dropped rather than kept, because a reader must never see a
      // lane row beside a failure that says the read did not happen. The next
      // successful collection republishes without `error` — the two states are
      // distinguishable, which is the whole point.
      publish(failedBody(thrown, new Date().toISOString()));
    }
  };

  /** Coalesce overlapping watch/poll ticks so a change during an in-flight collect is not dropped. */
  const begin = (refreshPr: boolean): void => {
    refreshRunning = true;
    void refresh(refreshPr).finally(() => {
      refreshRunning = false;
      if (refreshQueued) {
        refreshQueued = false;
        const nextPr = queuedRefreshPr;
        queuedRefreshPr = false;
        begin(nextPr);
      }
    });
  };

  /**
   * The single refresh entry point. It refuses once `closed`, so neither a
   * watcher event that lands after `close()` nor a late poll tick can start a
   * collection. A refresh queued behind one already in flight is picked up by
   * `begin`'s drain loop — and `shutdown` empties that queue, so a refresh
   * queued before `close()` is never run after it.
   */
  const requestRefresh = (refreshPr: boolean): void => {
    if (closed) return;
    if (refreshRunning) {
      refreshQueued = true;
      queuedRefreshPr = queuedRefreshPr || refreshPr;
      return;
    }
    begin(refreshPr);
  };

  const scanRoots = resolveScanRoots(options.scanRoot);
  /**
   * Arm one watcher per lane artefact (`*.log`, `events.jsonl`) under each
   * `wave*` directory — on the files, never on the directories. On macOS a
   * directory `fs.watch` is FSEvents-backed and its native `close()` flushes
   * the watcher's pending event batch synchronously; under a backlogged
   * `fseventsd` (a full suite hammering the temp dir) that flush measured
   * 2–9 s, and it hung the awaited `close()` behind it. A file watcher is
   * kqueue-backed and closes in ~0 ms. The cost of the narrower scope: a lane
   * log created after startup is armed by the next poll tick, not the instant
   * it appears, and a file replaced under a new inode re-arms the same way.
   * Listings go through `deps.readdir` so a test can hold one in flight across
   * a close.
   */
  const syncWatchers = async (): Promise<void> => {
    try {
      const names = await deps.readdir(options.scanRoot);
      for (const name of names) {
        if (!name.startsWith("wave")) continue;
        const dir = join(options.scanRoot, name);
        let files: readonly string[];
        try {
          files = await deps.readdir(dir);
        } catch {
          continue; // the wave dir vanished mid-listing; the next tick retries
        }
        // close() may have run while a listing was in flight: never arm a
        // watcher after the shutdown has already closed the set it joins.
        if (closed) return;
        for (const file of files) {
          if (!file.endsWith(".log") && !file.endsWith(".jsonl")) continue;
          const path = join(dir, file);
          if (watched.has(path)) continue;
          try {
            const watcher = watchPath(
              path,
              (eventType) => {
                // A `rename` means the file was removed or replaced under a new
                // inode — a kqueue watch on the old inode goes dead, so live
                // pushes stop for it forever. Close this watcher and forget the
                // path so the next poll tick arms the file that is there now.
                if (eventType === "rename") {
                  watched.delete(path);
                  watcher.close();
                  return;
                }
                requestRefresh(false);
              },
              () => {
                // The watcher emitted `error` (its file vanished). Forget the path
                // and close it; the next poll tick re-arms if the file is back.
                watched.delete(path);
                watcher.close();
              },
            );
            // Arm first, ledger second: if `watchPath` threw, the path is not
            // marked watched and this `catch` keeps the tick going to the rest.
            watched.set(path, watcher);
          } catch {
            // The file vanished between the listing and the watch; the next tick
            // re-lists and re-arms whatever is present.
          }
        }
      }
    } catch {
      // No wave log root (yet); the poll picks it up.
    }
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const route = routeFor(req.method, req.url);
    if (route === "methodNotAllowed") {
      res.writeHead(405, { allow: "GET" });
      res.end();
      return;
    }
    if (route.kind === "notFound") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (route.kind === "index") {
      try {
        const html = await readFile(indexHtmlPath);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end();
      }
      return;
    }
    if (route.kind === "tokens") {
      await serveTokens(res, tokensCssPath);
      return;
    }
    if (route.kind === "status") {
      // The same published body the stream sends, collected on demand. A
      // failure is 200 with an `error` and no waves, exactly as SSE carries it:
      // one shape, one answer, whichever face asked.
      let body: StatusBody;
      try {
        body = await collectNow(true);
      } catch (thrown) {
        body = failedBody(thrown, new Date().toISOString());
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
      return;
    }
    if (route.kind === "stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`event: status\ndata: ${lastJson}\n\n`);
      clients.add(res);
      res.on("close", () => clients.delete(res));
      return;
    }
    await serveLog(
      res,
      scanRoots,
      route.wave,
      route.lane,
      route.search,
      deps.open,
    );
  };

  await refresh(true);
  await syncWatchers();
  const timer = setInterval(() => {
    requestRefresh(true);
    void syncWatchers();
  }, options.pollMs ?? DEFAULT_POLL_MS);
  timer.unref();

  /**
   * The one shutdown both paths run: stop the timer, refuse any further
   * arming or refreshing, close every watcher, and hand back. It is
   * synchronous by construction — the awaited half of `close()` is only ever
   * the HTTP server, whose teardown has a bound.
   */
  const shutdown = (): void => {
    closed = true;
    clearInterval(timer);
    for (const watcher of watched.values()) watcher.close();
    watched.clear();
    // Empty the queue: `begin`'s drain only restarts while `refreshQueued` is
    // set, so dropping it here means a refresh queued behind one already in
    // flight at close() is never run after the shutdown. `requestRefresh` also
    // refuses once `closed`, so nothing re-fills the queue afterwards.
    refreshQueued = false;
    queuedRefreshPr = false;
  };

  const server = createServer((req, res) => void handle(req, res));
  try {
    await listen(server, options.port);
  } catch (error) {
    shutdown();
    server.close();
    throw error;
  }
  const address = server.address() as { port: number };

  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      shutdown();
      for (const client of clients) client.end();
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** `/api/log/:wave/:lane` — tail of the lane log or a full export with `?full=1`. */
async function serveLog(
  res: ServerResponse,
  roots: readonly string[],
  wave: string,
  lane: string,
  search: URLSearchParams,
  open: (path: string) => Promise<TailHandle>,
): Promise<void> {
  if (search.get("full") === "1") {
    const logPath = await resolveLogPath(roots, wave, lane);
    if (logPath === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const st = await stat(logPath);
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": st.size,
        "content-disposition": `attachment; filename="${wave}-${lane}.log"`,
      });
      const stream = createReadStream(logPath);
      stream.on("error", () => {
        res.destroy();
      });
      res.on("close", () => {
        stream.destroy();
      });
      stream.pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  const kb = tailKb(search.get("tail"));
  if (kb === undefined) {
    res.writeHead(400);
    res.end();
    return;
  }
  const logPath = await resolveLogPath(roots, wave, lane);
  if (logPath === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const part = await readTail(open, logPath, kb * 1024);
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(part.tail);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

/**
 * `/tokens.css` — the project's tokens when it named a file: `:root` as a base
 * and `.dark` after it, extracted from that file and served as CSS. The base
 * declares everything; the theme block overrides what differs. Cascade order
 * matters: `:root` first, `.dark` second, so dark overrides still win. Fail
 * loudly on a missing file or a missing block — the route 500s and names the
 * file, because a page rendering with half a palette says nothing about which
 * half is missing.
 *
 * With no `tokensCssPath`, the built-in neutral set answers instead: a silent
 * fallback here would be the one case where the page looks fine and means
 * nothing about the project.
 */
async function serveTokens(
  res: ServerResponse,
  tokensCssPath: string | undefined,
): Promise<void> {
  if (tokensCssPath === undefined) {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(BUILTIN_TOKENS_CSS);
    return;
  }
  let css: string;
  try {
    css = await readFile(tokensCssPath, "utf8");
  } catch {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`tokens.css missing or unreadable: ${tokensCssPath}`);
    return;
  }
  const root = extractRootBlock(css);
  if (root === undefined) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`tokens.css has no :root block: ${tokensCssPath}`);
    return;
  }
  const dark = extractDarkBlock(css);
  if (dark === undefined) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`tokens.css has no dark block: ${tokensCssPath}`);
    return;
  }
  res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
  res.end(`${root}\n\n${dark}\n`);
}

function matchesSelectorItem(prelude: string, selector: string): boolean {
  const items = prelude.split(",").map((s) => s.trim());
  return items.includes(selector);
}

function extractTopLevelBlock(
  css: string,
  selector: string,
): string | undefined {
  let start = -1;
  let ruleStart = -1;
  let depth = 0;
  let inComment = false;
  let inQuote: "'" | '"' | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inComment) {
      if (ch === "*" && css[i + 1] === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (inQuote !== null) {
      if (ch === "\\") {
        i++;
      } else if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (depth === 0) {
      if (ch === ";") {
        ruleStart = -1;
      } else if (!/\s/.test(ch) && ruleStart < 0) {
        ruleStart = i;
      }
    }
    if (ch === "{") {
      if (depth === 0 && ruleStart >= 0) {
        const rawPrelude = css.slice(ruleStart, i);
        const prelude = rawPrelude.replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (matchesSelectorItem(prelude, selector)) {
          start = ruleStart;
        }
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (start >= 0) return css.slice(start, i + 1);
        ruleStart = -1;
      }
    }
  }
  return undefined;
}

/**
 * Extract the top-level `.dark { … }` block from a CSS file. One traversal,
 * skipping comments and strings throughout: a `.dark` mentioned inside a
 * comment or a string cannot start the match, and a brace inside either cannot
 * cut it short. The match is taken only in selector position, where the
 * character after the name cannot continue it, so `.darkish` is not `.dark`.
 * The returned rule carries its `.dark` selector — a faithful copy of the
 * project's block, not a headless `{ … }` body a browser would discard.
 * Returns undefined when there is no `.dark` block.
 */
export function extractDarkBlock(css: string): string | undefined {
  return extractTopLevelBlock(css, ".dark");
}

/**
 * Extract the top-level `:root { … }` block from a CSS file. One traversal,
 * skipping comments and strings throughout. Returns undefined when there is
 * no `:root` block.
 */
export function extractRootBlock(css: string): string | undefined {
  return extractTopLevelBlock(css, ":root");
}

/** Map a wave id back to its log directory by re-deriving ids from the roots. */
async function resolveLogPath(
  roots: readonly string[],
  wave: string,
  lane: string,
): Promise<string | undefined> {
  for (const root of roots) {
    let names: readonly string[];
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    const dir = names.find(
      (name) => name.startsWith("wave") && waveIdFromDirName(name) === wave,
    );
    if (dir !== undefined) {
      return join(root, dir, `${lane}.log`);
    }
  }
  return undefined;
}

function tailKb(raw: string | null): number | undefined {
  if (raw === null) return DEFAULT_TAIL_KB;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_TAIL_KB;
  if (parsed > MAX_TAIL_KB) return undefined;
  return parsed;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
