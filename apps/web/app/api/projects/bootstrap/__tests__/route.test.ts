/**
 * HTTP mapping and staging behaviour for `POST /api/projects/bootstrap` (F-08).
 *
 * NOTHING IS FAKED EXCEPT THE BINARY ITSELF. The route really spawns a child
 * process; the child is a small script this suite writes to a temp directory
 * and points `resolveHexagenBin` at. So the argv contract, the `answers.json`
 * the route stages, the read-back of the written files, and the staging cleanup
 * are all exercised for real — the child simply stands in for `hexagen
 * bootstrap` (which is not installed in a test run, and whose own behaviour is
 * covered by `packages/sync/__tests__/commands/bootstrap`).
 *
 * The stand-in records its argv, cwd, and the answers document it was handed
 * into `last-run.json` NEXT TO ITSELF — not inside the staging directory, which
 * the route deletes before the response is returned.
 *
 * Mocking `node:child_process` was tried first and does NOT work here: under
 * this Vitest config a builtin mock rewires the test file's own import binding
 * but not the route's, so the real `execFile` ran and every "the fake was
 * called" assertion silently passed against an empty recording. Verified, not
 * assumed — the route spawned the real node and returned MODULE_NOT_FOUND.
 *
 * Note the route exports only `POST`, `GET`, and the segment config: Next's
 * generated per-route type check rejects any other value export, so there are
 * no helper imports here and every case goes through the transport.
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const resolveHexagenBinMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/project-scan/hexagen-bin", () => ({
  resolveHexagenBin: resolveHexagenBinMock,
}));

vi.mock("@/lib/monorepo-root", () => ({
  findMonorepoRoot: () => "/workspace",
}));

vi.mock("../../../../../lib/rate-limiter", () => ({
  checkRateLimit: () => ({ allowed: true }),
}));

import { GET, POST } from "../route";

/** Mirrors of the route's own caps; they cannot be imported (see the header). */
const MAX_BOOTSTRAP_REQUEST_BYTES = 256 * 1024;
const MAX_CONTEXTS = 200;
const MAX_CONTEXT_DESCRIPTION_CHARS = 1_000;

const MANIFEST_YAML = "system: acme\nscope: acme\n";
const BASELINE_JSON = '{\n  "version": 1,\n  "entries": []\n}\n';

type Behaviour = "writes" | "writes-nothing" | "fails" | "hangs";

const BEHAVIOURS: Record<Behaviour, string> = {
  writes: `
    const archDir = path.join(root, ".architecture");
    fs.mkdirSync(archDir, { recursive: true });
    fs.writeFileSync(path.join(archDir, "manifest.yaml"), ${JSON.stringify(MANIFEST_YAML)});
    // Written on purpose: the route must NOT return this one.
    fs.writeFileSync(path.join(archDir, "layout.yaml"), "contexts:\\n  orders:\\n    root: .\\n");
    fs.writeFileSync(path.join(archDir, "arch-lint-baseline.json"), ${JSON.stringify(BASELINE_JSON)});
    console.log("Wrote:");
  `,
  "writes-nothing": `
    console.log("Would write:");
  `,
  fails: `
    process.stderr.write("\\u274c Refusing to overwrite existing architecture files:\\n  " + path.join(root, ".architecture", "manifest.yaml") + "\\n");
    process.exit(1);
  `,
  // Long enough to outlive any sane budget; dies on the SIGTERM execFile sends.
  hangs: `
    setTimeout(() => {}, 5000);
  `,
};

function cliSource(behaviour: Behaviour): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const argv = process.argv.slice(2);
function flag(name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : null;
}
const root = flag("--root");
const answersPath = flag("--answers");

let answers = null;
try {
  answers = JSON.parse(fs.readFileSync(answersPath, "utf8"));
} catch (error) {
  // Recorded as the failure it is: a silent null would let an assertion about
  // the answers document pass against nothing.
  answers = { unreadable: String(error) };
}

// Beside the script, NOT under the staging root the route deletes.
fs.writeFileSync(
  path.join(__dirname, "last-run.json"),
  JSON.stringify({ argv, cwd: process.cwd(), root, answersPath, answers }),
  "utf8",
);
${BEHAVIOURS[behaviour]}
`;
}

interface LastRun {
  argv: string[];
  cwd: string;
  root: string;
  answersPath: string;
  answers: Record<string, unknown>;
}

let cliDir: string;

/**
 * Write the stand-in and point the resolver at it.
 *
 * `kind: "shim"` writes an extension-less executable, which is what a
 * `node_modules/.bin/hexagen` shim looks like — the route must run that one
 * directly rather than through the Node interpreter.
 */
async function installFakeCli(
  behaviour: Behaviour,
  kind: "js" | "shim" = "js",
): Promise<string> {
  const file = path.join(cliDir, kind === "js" ? "cli.cjs" : "hexagen");
  await writeFile(file, cliSource(behaviour), "utf8");
  await chmod(file, 0o755);
  resolveHexagenBinMock.mockReturnValue(file);
  return file;
}

async function lastRun(): Promise<LastRun> {
  return JSON.parse(
    await readFile(path.join(cliDir, "last-run.json"), "utf8"),
  ) as LastRun;
}

/** The stand-in writes this the moment it starts; absent = it never ran. */
function cliRan(): boolean {
  return existsSync(path.join(cliDir, "last-run.json"));
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

interface PostOptions {
  origin?: string;
  contentLength?: string;
  rawText?: string;
}

async function postJson(
  body: unknown,
  options: PostOptions = {},
): Promise<Response> {
  const text = options.rawText ?? JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin) headers.set("origin", options.origin);
  if (options.contentLength !== undefined) {
    headers.set("content-length", options.contentLength);
  }
  const request = new NextRequest("http://localhost/api/projects/bootstrap", {
    method: "POST",
    headers,
    body: streamOf(text),
    // `duplex` is required for a streaming body; @types/node types it.
    duplex: "half",
  });
  return POST(request);
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    system: "acme",
    scope: "acme",
    architecture: "modular-monolith",
    contexts: [
      {
        name: "orders",
        include: true,
        type: "core",
        description: "Order capture",
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

/** True once the request is over: the route must leave no staging directory. */
function stagingRemoved(run: LastRun): boolean {
  return !existsSync(path.dirname(run.root));
}

beforeEach(async () => {
  cliDir = await mkdtemp(path.join(tmpdir(), "hexagen-fake-cli-"));
  resolveHexagenBinMock.mockReset();
  await installFakeCli("writes");
});

afterEach(async () => {
  await rm(cliDir, { recursive: true, force: true });
});

describe("POST /api/projects/bootstrap — request guards", () => {
  it("rejects a cross-origin POST without running anything", async () => {
    const response = await postJson(validBody(), {
      origin: "https://evil.example",
    });
    assert.equal(response.status, 403);
    assert.equal(cliRan(), false);
  });

  it("400s a non-numeric Content-Length before reading the body", async () => {
    const response = await postJson(validBody(), {
      contentLength: "not-a-number",
    });
    assert.equal(response.status, 400);
    assert.match(await errorOf(response), /Content-Length/i);
    assert.equal(cliRan(), false);
  });

  it("413s an oversized declared Content-Length", async () => {
    const response = await postJson(validBody(), {
      contentLength: String(MAX_BOOTSTRAP_REQUEST_BYTES + 1),
    });
    assert.equal(response.status, 413);
    assert.equal(cliRan(), false);
  });

  it("413s a chunked oversized body that declares no Content-Length", async () => {
    // The shape the header pre-check cannot see: chunked transfer encoding
    // omits Content-Length entirely, so without the capped read JSON.parse
    // would only run once the whole payload was already in memory.
    let pushed = 0;
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Deliberately endless: a correct route stops pulling on its own.
        pushed += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const request = new NextRequest("http://localhost/api/projects/bootstrap", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      body,
      // `duplex` is required for a streaming body; @types/node types it.
      duplex: "half",
    });

    const response = await POST(request);

    assert.equal(response.status, 413);
    assert.ok(
      pushed < MAX_BOOTSTRAP_REQUEST_BYTES * 2,
      `read ${pushed} bytes, which is not a bounded read`,
    );
    assert.equal(cliRan(), false);
  });

  it("400s a body stream that errors mid-read", async () => {
    // A client that disconnects, or a truncated upload. Letting the rejection
    // escape the handler would make Next report a routine transport hiccup as
    // a 500.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"system":'));
        controller.error(new Error("connection reset"));
      },
    });
    const request = new NextRequest("http://localhost/api/projects/bootstrap", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      body,
      // `duplex` is required for a streaming body; @types/node types it.
      duplex: "half",
    });

    const response = await POST(request);

    assert.equal(response.status, 400);
    assert.match(await errorOf(response), /request body/i);
    assert.equal(cliRan(), false);
  });
});

describe("POST /api/projects/bootstrap — body validation", () => {
  it("400s a body that is not JSON", async () => {
    const response = await postJson(null, { rawText: "{not json" });
    assert.equal(response.status, 400);
    assert.match(await errorOf(response), /JSON/i);
  });

  for (const [label, rawText] of [
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"acme"'],
    ["a number", "7"],
  ] as const) {
    it(`400s a body that is ${label}`, async () => {
      const response = await postJson(null, { rawText });
      assert.equal(response.status, 400);
    });
  }

  const rejections: Array<[string, unknown, RegExp]> = [
    ["a missing system", validBody({ system: undefined }), /system/i],
    ["a blank system", validBody({ system: "   " }), /system/i],
    ["a non-string system", validBody({ system: 7 }), /system/i],
    ["a non-string scope", validBody({ scope: { evil: true } }), /scope/i],
    [
      "a missing architecture",
      validBody({ architecture: undefined }),
      /architecture/i,
    ],
    [
      "an unknown architecture",
      validBody({ architecture: "event-sourced" }),
      /architecture/i,
    ],
    [
      "contexts that are not an array",
      validBody({ contexts: {} }),
      /contexts/i,
    ],
    ["zero contexts", validBody({ contexts: [] }), /context/i],
    [
      "a context that is not an object",
      validBody({ contexts: ["orders"] }),
      /contexts\[0\]/i,
    ],
    ["a nameless context", validBody({ contexts: [{ name: "  " }] }), /name/i],
    [
      "a context name carrying a path separator",
      validBody({ contexts: [{ name: "packages/orders" }] }),
      /path separator/i,
    ],
    [
      "a context name carrying a control character",
      validBody({ contexts: [{ name: "orders\u0001evil" }] }),
      /control character/i,
    ],
    [
      "an unknown context type",
      validBody({ contexts: [{ name: "orders", type: "anti-corruption" }] }),
      /type/i,
    ],
    [
      "an explicitly excluded context",
      validBody({ contexts: [{ name: "orders", include: false }] }),
      /include/i,
    ],
    [
      "dependsOn that is not an array",
      validBody({ contexts: [{ name: "orders", dependsOn: "billing" }] }),
      /dependsOn/i,
    ],
    [
      "two contexts with the same name",
      validBody({ contexts: [{ name: "orders" }, { name: "orders" }] }),
      /unique/i,
    ],
    [
      "a context that depends on itself",
      validBody({ contexts: [{ name: "orders", dependsOn: ["orders"] }] }),
      /itself/i,
    ],
    [
      "a dangling depends_on edge",
      validBody({ contexts: [{ name: "orders", dependsOn: ["billing"] }] }),
      /ratified contexts/i,
    ],
  ];

  for (const [label, body, pattern] of rejections) {
    it(`400s ${label} without running bootstrap`, async () => {
      const response = await postJson(body);
      assert.equal(response.status, 400);
      assert.match(await errorOf(response), pattern);
      assert.equal(cliRan(), false);
    });
  }

  it("400s more contexts than the cap", async () => {
    const contexts = Array.from({ length: MAX_CONTEXTS + 1 }, (_, i) => ({
      name: `context-${i}`,
    }));
    const response = await postJson(validBody({ contexts }));
    assert.equal(response.status, 400);
    assert.equal(cliRan(), false);
  });

  it("400s an over-long context description", async () => {
    const response = await postJson(
      validBody({
        contexts: [
          {
            name: "orders",
            description: "x".repeat(MAX_CONTEXT_DESCRIPTION_CHARS + 1),
          },
        ],
      }),
    );
    assert.equal(response.status, 400);
    assert.match(await errorOf(response), /description/i);
  });
});

describe("POST /api/projects/bootstrap — invocation", () => {
  it("runs `bootstrap --root <staged> --answers <file>` through the interpreter", async () => {
    const bin = await installFakeCli("writes");
    const response = await postJson(validBody());
    assert.equal(response.status, 200);

    const run = await lastRun();
    // A `.cjs`/`.js` bin is launched via the current interpreter, so the script
    // sees exactly our arguments after its own path.
    assert.deepEqual(run.argv, [
      "bootstrap",
      "--root",
      run.root,
      "--answers",
      run.answersPath,
    ]);
    // The child ran IN the staging root. Compared by suffix, not equality: on
    // macOS the child's `process.cwd()` resolves the /var -> /private/var
    // symlink while `tmpdir()` does not, and the directory is gone by now, so
    // realpath cannot be used to reconcile them.
    assert.ok(
      run.cwd === run.root || run.cwd.endsWith(run.root),
      `cwd ${run.cwd} is not the staging root ${run.root}`,
    );
    // `--force` is never passed: the staging root is fresh, so bootstrap's
    // overwrite refusal cannot fire on a legitimate run.
    assert.equal(run.argv.includes("--force"), false);
    assert.ok(bin.endsWith("cli.cjs"));
  });

  it("runs an extension-less bin shim directly", async () => {
    await installFakeCli("writes", "shim");
    const response = await postJson(validBody());
    assert.equal(response.status, 200);
    const run = await lastRun();
    assert.deepEqual(run.argv, [
      "bootstrap",
      "--root",
      run.root,
      "--answers",
      run.answersPath,
    ]);
  });

  it("writes answers.json outside the project root it hands to --root", async () => {
    await postJson(validBody());
    const run = await lastRun();
    // `detectWorkspaces(root)` reads everything under the root; the answers
    // document is an input to the run, not part of the described project.
    assert.equal(path.dirname(run.answersPath) === run.root, false);
    assert.equal(path.dirname(run.root), path.dirname(run.answersPath));
  });

  it("hands bootstrap only whitelisted keys, rebuilt", async () => {
    await postJson(
      validBody({
        evil: "top-level",
        contexts: [
          {
            name: "  orders  ",
            include: true,
            type: "supporting",
            description: "  Order capture  ",
            dependsOn: ["billing", "billing", "  "],
            evil: "per-context",
          },
          { name: "billing" },
        ],
      }),
    );

    assert.deepEqual((await lastRun()).answers, {
      system: "acme",
      scope: "acme",
      architecture: "modular-monolith",
      contexts: [
        {
          name: "orders",
          include: true,
          type: "supporting",
          root: ".",
          description: "Order capture",
          // Deduplicated, trimmed, and the empty residue dropped.
          dependsOn: ["billing"],
        },
        {
          name: "billing",
          include: true,
          type: "core",
          root: ".",
          description: "",
          dependsOn: [],
        },
      ],
    });
  });

  it("normalises the scope with the canonical sanitizeScope", async () => {
    await postJson(validBody({ scope: "@Acme Corp!" }));
    assert.equal(
      (await lastRun()).answers.scope,
      "acme-corp",
      "the scope written to answers.json must match what S4 previewed",
    );
  });

  it("falls back to the system name when the scope is absent", async () => {
    await postJson(validBody({ system: "Acme Platform", scope: undefined }));
    assert.equal((await lastRun()).answers.scope, "acme-platform");
  });

  it("falls back to the system name when the scope is blank", async () => {
    await postJson(validBody({ system: "Acme Platform", scope: "   " }));
    assert.equal((await lastRun()).answers.scope, "acme-platform");
  });
});

describe("POST /api/projects/bootstrap — outcomes", () => {
  it("returns manifest.yaml and the baseline, and never layout.yaml", async () => {
    const response = await postJson(validBody());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");

    const body = (await response.json()) as {
      files: Array<{ path: string; contents: string }>;
    };
    assert.deepEqual(
      body.files.map((file) => file.path),
      [".architecture/manifest.yaml", ".architecture/arch-lint-baseline.json"],
    );
    assert.equal(body.files[0].contents, MANIFEST_YAML);
    assert.equal(body.files[1].contents, BASELINE_JSON);
    // The stand-in DID write a layout.yaml. It is deliberately not returned: a
    // server-side layout is roots-only and would be a lossy overwrite of the
    // layout S3 ratified.
    assert.equal(
      body.files.some((file) => file.path.endsWith("layout.yaml")),
      false,
    );
  });

  it("deletes the staging directory after a successful run", async () => {
    await postJson(validBody());
    assert.equal(stagingRemoved(await lastRun()), true);
  });

  it("503s when the hexagen CLI is not on this server, without running it", async () => {
    resolveHexagenBinMock.mockReturnValue(null);
    const response = await postJson(validBody());
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string; reason: string };
    assert.equal(body.reason, "cli-unavailable");
    assert.match(body.error, /hexagen/i);
    assert.equal(cliRan(), false);
  });

  it("504s when bootstrap overruns its budget, and still cleans up", async () => {
    await installFakeCli("hangs");
    const original = process.env.HEXAGEN_BOOTSTRAP_TIMEOUT_MS;
    process.env.HEXAGEN_BOOTSTRAP_TIMEOUT_MS = "300";
    try {
      const response = await postJson(validBody());
      assert.equal(response.status, 504);
      const body = (await response.json()) as { error: string; reason: string };
      assert.equal(body.reason, "timed-out");
      assert.equal(stagingRemoved(await lastRun()), true);
    } finally {
      if (original === undefined) {
        delete process.env.HEXAGEN_BOOTSTRAP_TIMEOUT_MS;
      } else {
        process.env.HEXAGEN_BOOTSTRAP_TIMEOUT_MS = original;
      }
    }
  });

  it("500s a non-zero exit and does not echo the CLI's stderr", async () => {
    await installFakeCli("fails");
    const response = await postJson(validBody());
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string; reason: string };
    assert.equal(body.reason, "bootstrap-failed");
    // The stand-in printed an absolute staging path, exactly as the real
    // command does. Server paths must not reach the client.
    assert.equal(body.error.includes("Refusing to overwrite"), false);
    assert.equal(body.error.includes(tmpdir()), false);
    assert.equal(stagingRemoved(await lastRun()), true);
  });

  it("500s when bootstrap exits cleanly but writes nothing", async () => {
    await installFakeCli("writes-nothing");
    const response = await postJson(validBody());
    assert.equal(response.status, 500);
    assert.equal(
      ((await response.json()) as { reason: string }).reason,
      "bootstrap-failed",
    );
    assert.equal(stagingRemoved(await lastRun()), true);
  });
});

describe("GET /api/projects/bootstrap", () => {
  it("returns 405 with an Allow: POST header", async () => {
    const response = await GET();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
  });
});
