import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  buildCloneArgs,
  cloneRepository,
  cloneUrlFor,
  GITHUB_SCAN_ENV_VAR,
  isGitHubScanEnabled,
  MAX_CLONE_DISK_BYTES,
  measureTree,
  parseProgressLine,
  parseRepoReference,
  preflightRepository,
  type CloneProgress,
  type CloneWorkspace,
  type RepoReference,
  createCloneWorkspace,
} from "./clone";

/* ------------------------------------------------------------------ */
/* Kill switch (bounding requirement 9)                                */
/* ------------------------------------------------------------------ */

describe("isGitHubScanEnabled", () => {
  it("is OFF for every value that is not an explicit enabling one", () => {
    const off = [
      undefined,
      "",
      "   ",
      "0",
      "no",
      "off",
      "false",
      "enabled",
      "yes",
      "tru",
      "truee",
      "1 1",
      "on",
    ];
    for (const value of off) {
      assert.equal(
        isGitHubScanEnabled({ [GITHUB_SCAN_ENV_VAR]: value }),
        false,
        `expected OFF for ${JSON.stringify(value)}`,
      );
    }
    // Absent key entirely.
    assert.equal(isGitHubScanEnabled({}), false);
  });

  it("is ON only for '1' and 'true', case- and whitespace-insensitive", () => {
    for (const value of ["1", " 1 ", "true", "TRUE", " True "]) {
      assert.equal(
        isGitHubScanEnabled({ [GITHUB_SCAN_ENV_VAR]: value }),
        true,
        `expected ON for ${JSON.stringify(value)}`,
      );
    }
  });

  it("does not read any other env var", () => {
    assert.equal(
      isGitHubScanEnabled({ BROWNFIELD_GITHUB_SCAN_ENABLED: "1" }),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Reference parsing (bounding requirements 1 and 2)                   */
/* ------------------------------------------------------------------ */

describe("parseRepoReference — hostile input", () => {
  const rejected: readonly [string, string][] = [
    // --- SSRF: other hosts ---
    ["https://evil.tld/acme/checkout", "arbitrary host"],
    ["https://gitlab.com/acme/checkout", "another forge"],
    ["https://127.0.0.1/acme/checkout", "loopback"],
    ["https://169.254.169.254/acme/checkout", "cloud metadata"],
    ["https://localhost/acme/checkout", "localhost"],
    // --- SSRF: hosts that merely LOOK like github.com ---
    ["https://evilgithub.com/acme/checkout", "suffix match would allow this"],
    [
      "https://github.com.evil.tld/acme/checkout",
      "prefix match would allow this",
    ],
    ["https://github.com./acme/checkout", "trailing-dot FQDN"],
    ["https://not-github.com/acme/checkout", "hyphenated look-alike"],
    // --- SSRF: userinfo smuggling ---
    ["https://github.com@evil.tld/acme/checkout", "host is evil.tld"],
    ["https://user:pass@github.com/acme/checkout", "credentials in URL"],
    ["https://token@github.com/acme/checkout", "username only"],
    // --- SSRF: non-https schemes ---
    ["ssh://git@github.com/acme/checkout.git", "ssh"],
    ["git://github.com/acme/checkout.git", "git protocol"],
    ["file:///etc/passwd", "local file"],
    ["file://github.com/acme/checkout", "file with a github authority"],
    ["http://github.com/acme/checkout", "cleartext"],
    ["ext::sh -c whoami", "git ext:: command execution"],
    ["git@github.com:acme/checkout.git", "scp-style"],
    // --- SSRF: ports ---
    ["https://github.com:8080/acme/checkout", "non-default port"],
    ["https://github.com:22/acme/checkout", "ssh port"],
    // --- IDN / homoglyph ---
    ["https://githüb.com/acme/checkout", "umlaut homoglyph"],
    ["https://gıthub.com/acme/checkout", "dotless-i homoglyph"],
    ["https://xn--githb-0va.com/acme/checkout", "punycode directly"],
    // --- path traversal in the segments ---
    ["acme/../../../etc/passwd", "traversal in shorthand"],
    ["../acme/checkout", "leading traversal"],
    ["https://github.com/acme/checkout/tree/main", "three segments"],
    ["https://github.com/acme", "one segment"],
    ["acme", "shorthand with one segment"],
    ["acme/checkout/extra", "shorthand with three segments"],
    // --- argument injection ---
    ["--upload-pack=touch /tmp/pwn/repo", "flag as owner"],
    ["-oProxyCommand=id/repo", "ssh-style flag as owner"],
    ["https://github.com/-evil/repo", "owner starting with a dash"],
    ["https://github.com/acme/-evil", "repo starting with a dash"],
    ["--/repo", "bare dashes"],
    // --- charset ---
    ["https://github.com/acme owner/checkout", "space in owner"],
    ["https://github.com/acme%2f..%2f/checkout", "encoded slash"],
    ["acme/check out", "space in repo"],
    ["acme/checkout\n--upload-pack=id", "newline injection"],
    ["acme/checkout;id", "shell metacharacter"],
    ["acme/checkout$(id)", "command substitution"],
    ["acme/check`id`out", "backticks"],
    ["", "empty"],
    ["   ", "whitespace only"],
  ];

  for (const [input, why] of rejected) {
    it(`rejects ${JSON.stringify(input)} (${why})`, () => {
      const result = parseRepoReference(input);
      assert.equal(result.ok, false, `expected rejection for ${input}`);
    });
  }

  it("rejects a non-string reference", () => {
    for (const value of [undefined, null, 42, {}, ["acme/checkout"]]) {
      assert.equal(parseRepoReference(value).ok, false);
    }
  });

  it("rejects an absurdly long reference before parsing it", () => {
    assert.equal(parseRepoReference(`acme/${"a".repeat(5000)}`).ok, false);
  });

  it("normalizes `..` inside a URL path instead of escaping the origin", () => {
    // Verified against Node's WHATWG parser: `https://github.com/../../etc/acme`
    // has pathname `/etc/acme`, so the traversal is resolved BEFORE this module
    // sees it and the result is still a two-segment github.com reference. This
    // is accepted on purpose — the reconstructed clone URL is
    // `https://github.com/etc/acme.git`, which cannot reach another host. The
    // case is pinned here so a future reader does not mistake acceptance for a
    // missing traversal check.
    const result = parseRepoReference("https://github.com/../../etc/acme");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.reference.owner, "etc");
    assert.equal(result.reference.repo, "acme");
    assert.equal(
      cloneUrlFor(result.reference),
      "https://github.com/etc/acme.git",
    );
  });

  it("lower-cases the host but preserves owner/repo case", () => {
    const result = parseRepoReference("https://GitHub.com/Acme/Checkout");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.reference.owner, "Acme");
      assert.equal(result.reference.repo, "Checkout");
    }
  });
});

describe("parseRepoReference — accepted forms", () => {
  const accepted: readonly [string, string, string][] = [
    ["acme/checkout-service", "acme", "checkout-service"],
    ["https://github.com/acme/checkout-service", "acme", "checkout-service"],
    [
      "https://github.com/acme/checkout-service.git",
      "acme",
      "checkout-service",
    ],
    ["https://github.com/acme/checkout-service/", "acme", "checkout-service"],
    ["https://www.github.com/acme/checkout", "acme", "checkout"],
    ["  acme/checkout  ", "acme", "checkout"],
    // `.github` is a real repository name, so a blanket dot ban would be wrong.
    ["acme/.github", "acme", ".github"],
    ["acme/my.repo", "acme", "my.repo"],
    ["a/b", "a", "b"],
  ];

  for (const [input, owner, repo] of accepted) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      const result = parseRepoReference(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.reference.owner, owner);
      assert.equal(result.reference.repo, repo);
      assert.equal(result.reference.ref, null);
    });
  }
});

describe("parseRepoReference — the ref", () => {
  it("accepts an ordinary branch or tag", () => {
    for (const ref of ["main", "release/2026-08", "v1.2.3", "feat_x-1"]) {
      const result = parseRepoReference("acme/checkout", ref);
      assert.equal(result.ok, true, `expected ${ref} to be accepted`);
      if (result.ok) assert.equal(result.reference.ref, ref);
    }
  });

  it("treats absent/blank as 'use the default branch'", () => {
    for (const ref of [undefined, null, "", "   "]) {
      const result = parseRepoReference("acme/checkout", ref);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.reference.ref, null);
    }
  });

  it("rejects a ref that could become a git flag or option value", () => {
    const hostile = [
      "--upload-pack=id",
      "-oProxyCommand=id",
      "--depth=99999",
      "main;id",
      "main ..",
      "..",
      "a..b",
      "main\n--upload-pack=id",
      "main with space",
      "ref^{}",
      "ref:with:colons",
      "-main",
      42,
      {},
    ];
    for (const ref of hostile) {
      assert.equal(
        parseRepoReference("acme/checkout", ref).ok,
        false,
        `expected ${JSON.stringify(ref)} to be rejected`,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* URL and argv construction (requirements 1, 2, 7)                    */
/* ------------------------------------------------------------------ */

describe("cloneUrlFor", () => {
  it("re-constructs the URL from a literal origin", () => {
    assert.equal(
      cloneUrlFor({ owner: "acme", repo: "checkout", ref: null }),
      "https://github.com/acme/checkout.git",
    );
  });
});

describe("buildCloneArgs", () => {
  const reference: RepoReference = {
    owner: "acme",
    repo: "checkout",
    ref: "main",
  };

  it("is shallow, single-branch, tagless and submodule-free", () => {
    const args = buildCloneArgs(reference, "/tmp/ws/repo");
    assert.ok(args.includes("--depth"));
    assert.equal(args[args.indexOf("--depth") + 1], "1");
    assert.ok(args.includes("--single-branch"));
    assert.ok(args.includes("--no-tags"));
    assert.ok(args.includes("--no-recurse-submodules"));
    assert.ok(args.includes("submodule.recurse=false"));
  });

  it("terminates option parsing with `--` before the URL and destination", () => {
    const args = buildCloneArgs(reference, "/tmp/ws/repo");
    const terminator = args.indexOf("--");
    assert.notEqual(terminator, -1);
    assert.equal(args[terminator + 1], "https://github.com/acme/checkout.git");
    assert.equal(args[terminator + 2], "/tmp/ws/repo");
    // Nothing after the terminator except the two positionals.
    assert.equal(args.length, terminator + 3);
  });

  it("disables credential helpers, askpass, redirects and LFS filters", () => {
    const args = buildCloneArgs(reference, "/tmp/ws/repo");
    for (const expected of [
      "credential.helper=",
      "core.askPass=",
      "http.followRedirects=false",
      "filter.lfs.smudge=",
      "filter.lfs.process=",
      "filter.lfs.required=false",
      "init.templateDir=",
      "core.symlinks=false",
    ]) {
      assert.ok(args.includes(expected), `missing config ${expected}`);
    }
  });

  it("confines git to https, so ext:: / file:: cannot be reached", () => {
    const args = buildCloneArgs(reference, "/tmp/ws/repo");
    assert.ok(args.includes("protocol.allow=never"));
    assert.ok(args.includes("protocol.https.allow=always"));
  });

  it("omits --branch entirely when no ref was given", () => {
    const args = buildCloneArgs({ ...reference, ref: null }, "/tmp/ws/repo");
    assert.equal(args.includes("--branch"), false);
  });

  it("passes the ref as its own argv element, never interpolated", () => {
    const args = buildCloneArgs(reference, "/tmp/ws/repo");
    assert.equal(args[args.indexOf("--branch") + 1], "main");
    assert.equal(
      args.some((argument) => argument.includes("--branch=")),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Progress parsing (streaming contract: real bytes or none)           */
/* ------------------------------------------------------------------ */

describe("parseProgressLine", () => {
  it("parses git's own byte figure", () => {
    const parsed = parseProgressLine(
      "Receiving objects:  45% (1234/2741), 12.50 MiB | 5.00 MiB/s",
    );
    assert.notEqual(parsed, null);
    assert.equal(parsed?.receivedBytes, Math.round(12.5 * 1024 * 1024));
  });

  it("reports NO byte count rather than deriving one from a percentage", () => {
    const parsed = parseProgressLine("Resolving deltas:  60% (900/1500)");
    assert.notEqual(parsed, null);
    assert.equal(parsed?.receivedBytes, null);
  });

  it("never leaks the server's filesystem path", () => {
    const parsed = parseProgressLine(
      "Cloning into '/tmp/hexagen-clone-abc123/repo'...",
    );
    assert.notEqual(parsed, null);
    assert.equal(parsed?.line.includes("/tmp/"), false);
    assert.equal(parsed?.line.includes("hexagen-clone"), false);
  });

  it("drops anything not on the progress allow-list", () => {
    const dropped = [
      "fatal: could not read Username for 'https://github.com': No such device",
      "error: unable to write file /tmp/hexagen-clone-abc/repo/x",
      "warning: redirecting to https://internal.host/",
      "remote: Support for password authentication was removed",
      "ssh: connect to host 10.0.0.5 port 22",
      "",
      "   ",
    ];
    for (const line of dropped) {
      assert.equal(parseProgressLine(line), null, `should drop: ${line}`);
    }
  });

  it("truncates a very long allow-listed line", () => {
    const parsed = parseProgressLine(`Receiving objects: ${"x".repeat(5000)}`);
    assert.notEqual(parsed, null);
    assert.ok((parsed?.line.length ?? 0) <= 200);
  });
});

/* ------------------------------------------------------------------ */
/* Preflight (bounding requirement 3)                                  */
/* ------------------------------------------------------------------ */

const REFERENCE: RepoReference = {
  owner: "acme",
  repo: "checkout",
  ref: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("preflightRepository", () => {
  it("calls only api.github.com and sends no Authorization header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ size: 1024, default_branch: "main" });
    }) as unknown as typeof fetch;

    await preflightRepository(REFERENCE, { fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.github.com/repos/acme/checkout");
    const headers = calls[0].init.headers as Record<string, string>;
    const headerNames = Object.keys(headers).map((name) => name.toLowerCase());
    assert.equal(headerNames.includes("authorization"), false);
    assert.equal(headerNames.includes("cookie"), false);
  });

  it("refuses to follow a redirect", async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      assert.equal(init.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { Location: "https://evil.tld/" },
      });
    }) as unknown as typeof fetch;

    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "clone_failed");
  });

  it("reads `size` as KILOBYTES", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ size: 2048 })) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.sizeBytes, 2048 * 1024);
  });

  it("refuses a repository over the size cap", async () => {
    // 200 MB reported as KB, against a 128 MiB cap.
    const fetchImpl = (async () =>
      jsonResponse({ size: 200_000 })) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "repo_too_large");
  });

  it("would allow the same figure if `size` were misread as bytes (guards the 1024x bug)", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ size: 200_000 })) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, {
      fetchImpl,
      maxRepoSizeBytes: 300_000,
    });
    // 200_000 KB = 204_800_000 bytes, which is over the 300_000-byte cap.
    // If the KB->bytes conversion were dropped this assertion would flip.
    assert.equal(result.ok, false);
  });

  it("fails closed when `size` is missing or nonsense", async () => {
    for (const body of [
      {},
      { size: null },
      { size: "big" },
      { size: -1 },
      { size: Number.NaN },
    ]) {
      const fetchImpl = (async () =>
        jsonResponse(body)) as unknown as typeof fetch;
      const result = await preflightRepository(REFERENCE, { fetchImpl });
      assert.equal(
        result.ok,
        false,
        `expected refusal for ${JSON.stringify(body)}`,
      );
    }
  });

  it("refuses a private repository", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ size: 10, private: true })) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, false);
  });

  it("maps a 404 to clone_failed, not to a crash", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: "Not Found" }, 404)) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "clone_failed");
  });

  it("only trusts a default_branch that passes the ref grammar", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        size: 1,
        default_branch: "--upload-pack=id",
      })) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.defaultBranch, null);
  });

  it("never surfaces the failure detail as user-facing prose", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.7:443");
    }) as unknown as typeof fetch;
    const result = await preflightRepository(REFERENCE, { fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) {
      // `detail` exists for the log. The route must never echo it, which is
      // asserted on the route side; here we only pin that it is a separate
      // field from any message.
      assert.ok("detail" in result);
      assert.equal("message" in result, false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Clone bounding (requirements 4, 5, 6, 8)                            */
/* ------------------------------------------------------------------ */

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  kill = vi.fn();

  finish(code: number) {
    this.emit("close", code);
  }
}

function fakeWorkspace(): CloneWorkspace {
  return {
    repoDir: "/tmp/fake-workspace/repo",
    homeDir: "/tmp/fake-workspace/home",
    cleanup: async () => {},
  };
}

interface Harness {
  child: FakeChild;
  spawnImpl: ReturnType<typeof vi.fn>;
  spawnOptions: () => Record<string, unknown>;
}

/** Let queued stream `data` events run before the child is closed. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function harness(): Harness {
  const child = new FakeChild();
  let options: Record<string, unknown> = {};
  const spawnImpl = vi.fn(
    (_file: string, _args: string[], opts: Record<string, unknown>) => {
      options = opts;
      return child;
    },
  );
  return {
    child,
    spawnImpl,
    spawnOptions: () => options,
  };
}

describe("cloneRepository — environment (requirement 8)", () => {
  it("builds the child env from scratch: no token can reach git", async () => {
    const bench = harness();
    // Secrets that are present in the real server process.
    process.env.GITHUB_TOKEN = "ghp_should_never_be_passed";
    process.env.NEXTAUTH_SECRET = "secret_should_never_be_passed";
    process.env.HTTPS_PROXY = "http://proxy.internal:3128";

    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        killImpl: () => {},
        measure: async () => ({ bytes: 0, entries: 0 }),
        sampleIntervalMs: 10_000,
      },
    });
    bench.child.finish(0);
    await clone;

    const env = bench.spawnOptions().env as Record<string, string>;
    delete process.env.GITHUB_TOKEN;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.HTTPS_PROXY;

    assert.equal("GITHUB_TOKEN" in env, false);
    assert.equal("NEXTAUTH_SECRET" in env, false);
    assert.equal("HTTPS_PROXY" in env, false);
    assert.equal(
      Object.values(env).some((value) => value.includes("ghp_")),
      false,
    );
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(env.GIT_ALLOW_PROTOCOL, "https");
    assert.equal(env.GIT_LFS_SKIP_SMUDGE, "1");
    // HOME points at the throwaway workspace, so no ~/.git-credentials exists.
    assert.equal(env.HOME, "/tmp/fake-workspace/home");
  });

  it("never enables a shell and spawns in its own process group", async () => {
    const bench = harness();
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        killImpl: () => {},
        measure: async () => ({ bytes: 0, entries: 0 }),
        sampleIntervalMs: 10_000,
      },
    });
    bench.child.finish(0);
    await clone;

    const options = bench.spawnOptions();
    assert.equal("shell" in options, false);
    assert.equal(bench.spawnImpl.mock.calls[0][0], "git");
    if (process.platform !== "win32") {
      assert.equal(options.detached, true);
    }
  });
});

describe("cloneRepository — wall-clock kill (requirement 5)", () => {
  it("kills the whole process GROUP, SIGTERM then SIGKILL", async () => {
    const bench = harness();
    const signals: { pid: number; signal: string }[] = [];

    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        timeoutMs: 5,
        killGraceMs: 5,
        sampleIntervalMs: 10_000,
        measure: async () => ({ bytes: 0, entries: 0 }),
        killImpl: (pid, signal) => {
          signals.push({ pid, signal });
          // The real SIGTERM makes git exit; model that, but only after the
          // SIGKILL timer has had a chance to be scheduled.
          if (signal === "SIGTERM") {
            setTimeout(() => bench.child.finish(143), 20);
          }
        },
      },
    });

    const result = await clone;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "timeout");

    assert.ok(signals.length >= 1, "expected at least one signal");
    // Negative pid == the process group, not just the parent. A clone spawns
    // git-remote-https and index-pack; signalling only the parent leaves them.
    assert.ok(
      signals.every((entry) => entry.pid < 0),
      "every signal must target the process group",
    );
    assert.equal(signals[0].signal, "SIGTERM");
    assert.ok(
      signals.some((entry) => entry.signal === "SIGKILL"),
      "SIGKILL must follow SIGTERM",
    );
  });

  it("aborts on the caller's signal (client disconnect)", async () => {
    const bench = harness();
    const controller = new AbortController();
    const signals: string[] = [];

    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      signal: controller.signal,
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        timeoutMs: 60_000,
        killGraceMs: 5,
        sampleIntervalMs: 10_000,
        measure: async () => ({ bytes: 0, entries: 0 }),
        killImpl: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGTERM") bench.child.finish(143);
        },
      },
    });

    controller.abort();
    const result = await clone;
    assert.equal(result.ok, false);
    assert.ok(signals.includes("SIGTERM"));
  });
});

describe("cloneRepository — size enforced DURING the clone (requirement 4)", () => {
  it("kills a clone that outgrows the disk budget even after a clean preflight", async () => {
    const bench = harness();
    let bytes = 0;
    const signals: string[] = [];

    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        timeoutMs: 60_000,
        killGraceMs: 5,
        sampleIntervalMs: 5,
        maxDiskBytes: 1000,
        // The tree grows past the cap while the clone runs. No preflight is
        // involved here at all — that is the point of the test.
        measure: async () => {
          bytes += 400;
          return { bytes, entries: 1 };
        },
        killImpl: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGTERM") bench.child.finish(143);
        },
      },
    });

    const result = await clone;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "repo_too_large");
    assert.ok(signals.includes("SIGTERM"));
  });

  it("kills a clone that outgrows the ENTRY budget", async () => {
    const bench = harness();
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        killGraceMs: 5,
        sampleIntervalMs: 5,
        maxEntries: 10,
        measure: async () => ({ bytes: 1, entries: 5000 }),
        killImpl: (_pid, signal) => {
          if (signal === "SIGTERM") bench.child.finish(143);
        },
      },
    });
    const result = await clone;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "repo_too_large");
  });

  it("kills on git's OWN reported byte count, between disk samples", async () => {
    const bench = harness();
    const signals: string[] = [];
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        // The disk sampler is effectively disabled, so only the stderr-derived
        // figure can catch this.
        sampleIntervalMs: 10_000,
        killGraceMs: 5,
        maxDiskBytes: 1024 * 1024,
        measure: async () => ({ bytes: 0, entries: 0 }),
        killImpl: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGTERM") bench.child.finish(143);
        },
      },
    });

    bench.child.stderr.write(
      "Receiving objects:  10% (1/10), 900.00 MiB | 50.00 MiB/s\r",
    );

    const result = await clone;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "repo_too_large");
  });

  it("re-checks the tree after a clean exit, closing the between-samples gap", async () => {
    const bench = harness();
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        sampleIntervalMs: 10_000, // never fires
        maxDiskBytes: 1000,
        measure: async () => ({ bytes: 999_999, entries: 1 }),
        killImpl: () => {},
      },
    });
    bench.child.finish(0);
    const result = await clone;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "repo_too_large");
  });

  it("succeeds when the clone stays inside every budget", async () => {
    const bench = harness();
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        sampleIntervalMs: 10_000,
        measure: async () => ({ bytes: 1024, entries: 12 }),
        killImpl: () => {},
      },
    });
    bench.child.finish(0);
    const result = await clone;
    assert.equal(result.ok, true);
  });

  it("treats a non-zero git exit as clone_failed without echoing stderr", async () => {
    const bench = harness();
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        sampleIntervalMs: 10_000,
        measure: async () => ({ bytes: 0, entries: 0 }),
        killImpl: () => {},
      },
    });
    bench.child.stderr.write(
      "fatal: unable to access 'https://github.com/acme/checkout.git/': " +
        "Could not resolve host; /tmp/hexagen-clone-abc/repo\n",
    );
    await flush();
    bench.child.finish(128);
    const result = await clone;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "clone_failed");
      assert.equal(result.detail.includes("/tmp/"), false);
      assert.equal(result.detail.includes("fatal:"), false);
    }
  });
});

describe("cloneRepository — progress forwarding", () => {
  it("forwards only allow-listed lines, with git's own byte figures", async () => {
    const bench = harness();
    const progress: CloneProgress[] = [];
    const clone = cloneRepository({
      reference: REFERENCE,
      workspace: fakeWorkspace(),
      onProgress: (entry) => progress.push(entry),
      deps: {
        spawnImpl:
          bench.spawnImpl as unknown as typeof import("node:child_process").spawn,
        sampleIntervalMs: 10_000,
        measure: async () => ({ bytes: 0, entries: 0 }),
        killImpl: () => {},
      },
    });

    bench.child.stderr.write("remote: Enumerating objects: 2481, done.\r");
    bench.child.stderr.write(
      "Receiving objects: 100% (2481/2481), 18.40 MiB | 9.00 MiB/s, done.\r",
    );
    bench.child.stderr.write("fatal: something with /tmp/hexagen-clone-x\n");
    await flush();
    bench.child.finish(0);
    await clone;

    assert.equal(progress.length, 2);
    assert.ok(progress[0].line.startsWith("remote: Enumerating objects"));
    assert.equal(progress[0].receivedBytes, null);
    assert.equal(progress[1].receivedBytes, Math.round(18.4 * 1024 * 1024));
    assert.equal(
      progress.some((entry) => entry.line.includes("/tmp/")),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* measureTree                                                         */
/* ------------------------------------------------------------------ */

describe("measureTree", () => {
  it("returns zero for a directory that does not exist", async () => {
    const measurement = await measureTree("/definitely/not/a/real/path/xyz");
    assert.equal(measurement.bytes, 0);
    assert.equal(measurement.entries, 0);
  });

  it("stops early once the entry budget is blown", async () => {
    // Measured against this repo's own node-free worktree; the assertion is
    // about the early-stop contract, not about any particular tree.
    const measurement = await measureTree(process.cwd(), { maxEntries: 1 });
    assert.ok(measurement.entries <= 2);
  });

  it("has a default disk cap that matches the exported bound", () => {
    assert.equal(MAX_CLONE_DISK_BYTES, 384 * 1024 * 1024);
  });
});

describe("createCloneWorkspace failure paths", () => {
  // Raised in review on #616 and held open until covered, correctly: the
  // rollback branch is where a workspace becomes an ORPHAN, and an orphan
  // outside /tmp is permanent until the next process sweeps it. Both fs calls
  // are injected because no fixture can make `rm` fail on a real filesystem
  // without running as another user; `cloneRepository` already injects
  // `spawnImpl`/`killImpl` for the same reason.
  const base = tmpdir();

  it("reports the failure and no orphan when rollback succeeds", async () => {
    let removed: string | null = null;
    const result = await createCloneWorkspace(base, {
      mkdirImpl: (async () => {
        throw new Error("EACCES: home unwritable");
      }) as unknown as typeof mkdir,
      rmImpl: (async (target: string) => {
        removed = target;
      }) as unknown as typeof rm,
    });

    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.match(result.failure.reason, /home unwritable/);
    // The directory was cleaned up, so there is nothing for anyone to chase.
    assert.equal(result.failure.orphanedAt, null);
    assert.equal(result.failure.rollbackReason, null);
    assert.ok(removed !== null, "rollback must remove the mkdtemp root");
  });

  it("reports WHERE the orphan was left when rollback also fails", async () => {
    const result = await createCloneWorkspace(base, {
      mkdirImpl: (async () => {
        throw new Error("ENOSPC: no space left");
      }) as unknown as typeof mkdir,
      rmImpl: (async () => {
        throw new Error("EPERM: cannot remove");
      }) as unknown as typeof rm,
    });

    assert.ok(!result.ok);
    // Both failures survive. A rethrow could only ever carry the first, and
    // the second is the one that says a directory was left behind.
    assert.match(result.failure.reason, /no space left/);
    assert.match(result.failure.rollbackReason ?? "", /cannot remove/);
    assert.ok(
      result.failure.orphanedAt?.includes("hexagen-clone-"),
      "the orphan path is reported so it can be found and removed",
    );

    // Clean up the directory this test genuinely created, since the injected
    // rm deliberately did not.
    if (result.failure.orphanedAt !== null) {
      await rm(result.failure.orphanedAt, { recursive: true, force: true });
    }
  });
});
