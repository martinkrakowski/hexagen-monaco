/**
 * `POST /api/projects/bootstrap` (F-08) — turn a ratified S4 manifest into a
 * real `manifest.yaml`, by running the real `hexagen bootstrap`.
 *
 * WHY THIS ROUTE EXISTS AT ALL. The S4 screen collects what the user ratified;
 * it does not get to decide what `manifest.yaml` looks like. `emitManifest` in
 * `packages/sync/src/commands/bootstrap/index.ts` does, and it is the same code
 * path a user gets from the CLI on their own machine. A route that serialized
 * YAML itself would be a second emitter, free to drift from the first, and the
 * user would find out only after the file landed in their repository. So this
 * route stages a temp project, invokes bootstrap against it, and returns what
 * bootstrap wrote.
 *
 * WHY A SUBPROCESS AND NOT `runBootstrap` DIRECTLY. Verified, not assumed:
 * `runBootstrap` is **not reachable** from `apps/web`. `@hexagen/sync`'s
 * `package.json` declares `"exports": { "." : … }` and nothing else, its barrel
 * (`src/index.ts`) re-exports the engine/config/types/domain surface but no
 * `commands/*`, and its tsup config emits exactly two bundles (`dist/cli.js`,
 * `dist/index.js`, `splitting: false`) — so there is no `dist/commands/...`
 * module to deep-import even if the exports map allowed one. Surfacing
 * `runBootstrap` on the barrel is a `packages/sync` change and is outside this
 * packet's fence. The CLI is therefore the seam, which is also the seam
 * `CliHexagenScanAdapter` already uses for `hexagen scan`: `execFile` with an
 * argv array (never a shell string), against the binary resolved from the
 * monorepo root rather than `process.cwd()`.
 *
 * HOW ANSWERS REACH BOOTSTRAP. `BootstrapOptions` (`root` / `yes` /
 * `answersPath` / `stdinJson` / `dryRun` / `force` / `skipLayout`) carries **no
 * answers field** — it is invocation control only. `BootstrapAnswers` is the
 * payload, and it reaches `runBootstrap` solely through `answersPath` (a JSON
 * file) or `--stdin-json`. This route writes the validated answers to
 * `answers.json` in the staging directory and passes `--answers`.
 *
 * WHY THE ROUTE OWNS ITS REQUEST SCHEMA. `ManifestRatificationPayload` lives in
 * `features/brownfield/ManifestRatify/`. A route reaching into a feature slice
 * is backwards regardless of which directories the boundary checker currently
 * covers, and — more importantly — a type declared by the client is a claim,
 * not a guarantee. Everything below treats the body as hostile input: it is
 * size-capped before it is read, validated field by field, and the object
 * handed to bootstrap is REBUILT from whitelisted keys rather than spread from
 * whatever arrived.
 *
 * WHY `layout.yaml` IS NOT RETURNED. Bootstrap writes one, but `emitLayout`
 * fills `layers:` from `detectWorkspaces(root)` — and `root` here is an empty
 * staging directory, because the user's source code is on THEIR machine and
 * this route deliberately never receives it. The layout it can write is
 * therefore roots-only: a strictly degraded copy of what S3 already ratified.
 * Returning it would invite a client to overwrite the good layout with the
 * lossy one, so it is discarded with the staging directory. S3 owns
 * `layout.yaml`; this route owns `manifest.yaml`.
 *
 * WHY NOTHING HERE IS EXPORTED FOR THE TESTS. Next generates a type-check stub
 * per route (`.next/types/app/**\/route.ts`) that runs
 * `checkFields<Diff<{GET?, POST?, runtime?, dynamic?, maxDuration?, …}, TEntry>>`
 * — every VALUE export beyond that list is a typecheck error, and
 * `apps/web/tsconfig.json` includes `.next/types/**\/*.ts`, so it fails
 * `yarn --cwd apps/web typecheck` (silently, until someone has built once).
 * Type-only exports are invisible to `typeof import(...)` and are therefore
 * safe. The suite consequently drives everything below through `POST`/`GET`
 * and a REAL subprocess, which is better evidence anyway.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
// `sanitizeScope` is the CANONICAL npm-scope normaliser
// (`packages/sync/src/types/manifest/helpers.ts`), surfaced on the public
// barrel for exactly this caller. Applied here so `answers.json` carries the
// same string the S4 screen previewed and `emitManifest` will write — one
// implementation, not a server-side re-derivation that can drift from it. The
// client-side mirror in `features/brownfield/ManifestRatify/scope-preview.ts`
// exists only because a `"use client"` module cannot pull in this bundle; the
// server has no such constraint and must not use the mirror.
import {
  sanitizeScope,
  type BoundedContext,
  type Manifest,
} from "@hexagen/sync";
import { guardMutation } from "@/lib/request-guards";
import { findMonorepoRoot } from "@/lib/monorepo-root";
import { resolveHexagenBin } from "@/lib/project-scan/hexagen-bin";
import { logger } from "../../../../lib/structured-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Bootstrap writes three small files from an already-validated answers
 * document — no import graph is walked and nothing is downloaded. The child is
 * capped at {@link bootstrapTimeoutMs} so the staging cleanup and the JSON
 * response still fit inside this budget even on the timeout path.
 */
export const maxDuration = 30;

/**
 * Own rate-limit namespace. This route spawns a process and touches the disk,
 * so it is more expensive than `install-gate` (compiled-in constants) and much
 * cheaper than `project-scan` (unpack + full lint). Isolated either way: a
 * bootstrap flood must not consume the scan budget or vice versa.
 */
const BOOTSTRAP_MUTATION_GUARD = {
  maxRequests: 10,
  windowMs: 60_000,
  keyPrefix: "project-bootstrap",
} as const;

/**
 * The body is a system name, a scope, an architecture, and a list of context
 * rows a human typed on one screen. 256 KiB is already far past any honest
 * client and keeps the JSON parse bounded.
 */
const MAX_BOOTSTRAP_REQUEST_BYTES = 256 * 1024;

const MAX_SYSTEM_CHARS = 100;
/** Raw input bound only. `sanitizeScope` still truncates to npm's 214. */
const MAX_SCOPE_INPUT_CHARS = 2_048;
const MAX_CONTEXTS = 200;
const MAX_CONTEXT_NAME_CHARS = 100;
const MAX_CONTEXT_DESCRIPTION_CHARS = 1_000;
const MAX_DEPENDS_ON_PER_CONTEXT = 200;

/** Bootstrap's own output, read back with a ceiling rather than slurped. */
const MAX_OUTPUT_FILE_BYTES = 1024 * 1024;

/** Child budget, with headroom under {@link maxDuration} for cleanup + JSON. */
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 20_000;

/** Never longer than this, whatever the environment says. */
const MAX_BOOTSTRAP_TIMEOUT_MS = 25_000;

/**
 * The child's wall-clock budget.
 *
 * An operational knob, not a constant, because `maxDuration` is not the same
 * everywhere this runs and a budget that outlives the request is worse than a
 * short one: the response is already gone, so the child is just burning a
 * process. Clamped to {@link MAX_BOOTSTRAP_TIMEOUT_MS} so a mistaken env value
 * cannot push the child past the route's own deadline, and read per call so it
 * is not frozen at module load.
 */
function bootstrapTimeoutMs(): number {
  const raw = process.env.HEXAGEN_BOOTSTRAP_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_BOOTSTRAP_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BOOTSTRAP_TIMEOUT_MS;
  }
  return Math.min(Math.floor(parsed), MAX_BOOTSTRAP_TIMEOUT_MS);
}

/** Bootstrap prints a handful of lines; anything beyond this is pathological. */
const MAX_BOOTSTRAP_STDIO_BYTES = 1024 * 1024;

const MAXBUFFER_ERROR_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/**
 * The closed sets an untrusted body is checked against.
 *
 * Spelled out here because both are TYPE unions upstream — there is no runtime
 * value to import and iterate. They are not trusted to stay in step by
 * inspection: the two `Expect<Equals<…>>` aliases below are compile-time
 * assertions against `@hexagen/sync`'s own types, so an arm added or removed
 * upstream fails `yarn --cwd apps/web typecheck` naming this file rather than
 * silently narrowing (or widening) what this route accepts.
 */
const BOOTSTRAP_ARCHITECTURES = [
  "modular-monolith",
  "microservices",
  "monolith",
] as const;
type BootstrapArchitecture = (typeof BOOTSTRAP_ARCHITECTURES)[number];

const BOOTSTRAP_CONTEXT_TYPES = [
  "core",
  "supporting",
  "generic",
  "shared-kernel",
  "driver",
] as const;
type BootstrapContextType = (typeof BOOTSTRAP_CONTEXT_TYPES)[number];

/** `hexagen bootstrap` writes `type: core` when the answers omit one. */
const DEFAULT_CONTEXT_TYPE: BootstrapContextType = "core";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

/**
 * Exported on purpose: `no-unused-vars` treats an unexported, unreferenced type
 * alias as dead code, and a type-level assertion has no runtime referent.
 */
export type ARCHITECTURE_PARITY = Expect<
  Equals<BootstrapArchitecture, NonNullable<Manifest["architecture"]>>
>;
export type CONTEXT_TYPE_PARITY = Expect<
  Equals<BootstrapContextType, NonNullable<BoundedContext["type"]>>
>;

/** One ratified context row, after validation. */
interface ValidatedContext {
  readonly name: string;
  readonly type: BootstrapContextType;
  readonly description: string;
  readonly dependsOn: readonly string[];
}

/** The whole request, after validation. */
interface ValidatedRequest {
  readonly system: string;
  readonly scope: string;
  readonly architecture: BootstrapArchitecture;
  readonly contexts: readonly ValidatedContext[];
}

/** One file bootstrap wrote, path relative to the project root. */
export interface BootstrapWrittenFile {
  readonly path: string;
  readonly contents: string;
}

export interface ProjectBootstrapResponse {
  readonly files: readonly BootstrapWrittenFile[];
}

/**
 * Every fallible step below returns one of these rather than throwing or
 * returning `null`: a swallowed failure here would surface as a 500 on a body
 * the client could have fixed, or — worse — as a 200 with nothing written.
 */
type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/**
 * Outcome of the bootstrap run itself, mapped to HTTP by {@link respond}.
 *
 * `unavailable` and `timed-out` are separated from `failed` because they are
 * different operational facts: no CLI on this server (the D-P1 packaging gap),
 * a run that overran its budget, and a run that genuinely broke want different
 * status codes and different alerts.
 */
type BootstrapOutcome =
  | { readonly kind: "wrote"; readonly files: BootstrapWrittenFile[] }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "timed-out"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reject C0 controls and DEL anywhere in a user-supplied string.
 *
 * These fields become YAML scalars and, downstream, log lines and terminal
 * output. js-yaml would quote or escape them rather than break the document,
 * so this is not an injection guard — it is a "no honest client sends a NUL or
 * a bare newline in a context name" guard, applied before the value can reach
 * a file, a log, or someone's terminal.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function validateText(
  value: unknown,
  field: string,
  maxChars: number,
): Validated<string> {
  if (typeof value !== "string") {
    return { ok: false, message: `${field} must be a string` };
  }
  if (value.length > maxChars) {
    return {
      ok: false,
      message: `${field} exceeds ${maxChars.toLocaleString()} characters`,
    };
  }
  if (CONTROL_CHARS.test(value)) {
    return { ok: false, message: `${field} contains control characters` };
  }
  return { ok: true, value: value.trim() };
}

function validateContext(
  raw: unknown,
  index: number,
): Validated<ValidatedContext> {
  if (!isRecord(raw)) {
    return { ok: false, message: `contexts[${index}] must be an object` };
  }

  // The wire carries only ratified rows — S4 DROPS excluded ones rather than
  // sending `include: false`. A row that says otherwise is not silently
  // reinterpreted in either direction: dropping it would write a manifest the
  // caller did not ask for, and honouring it as included would write a context
  // the user unticked. Both are wrong, so it is a 400.
  if (raw.include !== undefined && raw.include !== true) {
    return {
      ok: false,
      message: `contexts[${index}].include must be true — send only ratified contexts`,
    };
  }

  const name = validateText(
    raw.name,
    `contexts[${index}].name`,
    MAX_CONTEXT_NAME_CHARS,
  );
  if (!name.ok) return name;
  if (name.value.length === 0) {
    return { ok: false, message: `contexts[${index}].name is required` };
  }
  // The name becomes a mapping KEY in layout.yaml and the identity `depends_on`
  // edges resolve against. A path separator there is never meaningful and would
  // read as a nested path to something downstream.
  if (name.value.includes("/") || name.value.includes("\\")) {
    return {
      ok: false,
      message: `contexts[${index}].name must not contain a path separator`,
    };
  }

  let type: BootstrapContextType = DEFAULT_CONTEXT_TYPE;
  if (raw.type !== undefined) {
    const validated = validateText(
      raw.type,
      `contexts[${index}].type`,
      MAX_CONTEXT_NAME_CHARS,
    );
    if (!validated.ok) return validated;
    if (
      !(BOOTSTRAP_CONTEXT_TYPES as readonly string[]).includes(validated.value)
    ) {
      return {
        ok: false,
        message: `contexts[${index}].type must be one of: ${BOOTSTRAP_CONTEXT_TYPES.join(", ")}`,
      };
    }
    type = validated.value as BootstrapContextType;
  }

  let description = "";
  if (raw.description !== undefined) {
    const validated = validateText(
      raw.description,
      `contexts[${index}].description`,
      MAX_CONTEXT_DESCRIPTION_CHARS,
    );
    if (!validated.ok) return validated;
    description = validated.value;
  }

  const dependsOn: string[] = [];
  if (raw.dependsOn !== undefined) {
    if (!Array.isArray(raw.dependsOn)) {
      return {
        ok: false,
        message: `contexts[${index}].dependsOn must be an array`,
      };
    }
    if (raw.dependsOn.length > MAX_DEPENDS_ON_PER_CONTEXT) {
      return {
        ok: false,
        message: `contexts[${index}].dependsOn exceeds ${MAX_DEPENDS_ON_PER_CONTEXT} entries`,
      };
    }
    for (const [i, target] of raw.dependsOn.entries()) {
      const validated = validateText(
        target,
        `contexts[${index}].dependsOn[${i}]`,
        MAX_CONTEXT_NAME_CHARS,
      );
      if (!validated.ok) return validated;
      // An empty edge is dropped, not rejected: it is the residue of an edge
      // the user cleared, and it has no effect on the emitted manifest.
      if (validated.value.length === 0) continue;
      if (!dependsOn.includes(validated.value)) dependsOn.push(validated.value);
    }
  }

  return {
    ok: true,
    value: { name: name.value, type, description, dependsOn },
  };
}

/**
 * Validate the decoded body and REBUILD it from whitelisted keys.
 *
 * Nothing is spread from the incoming object: an unexpected key on the wire
 * must not survive into `answers.json`, where `readAnswers` would hand it
 * straight to `emitManifest` as a `BootstrapAnswers`. Structural failures are
 * all returned as messages — the caller maps every one of them to 400, so no
 * crafted body reaches the outer catch and reads as a 500.
 */
function validateBootstrapRequest(body: unknown): Validated<ValidatedRequest> {
  if (!isRecord(body)) {
    return { ok: false, message: "Request body must be a JSON object" };
  }

  const system = validateText(body.system, "system", MAX_SYSTEM_CHARS);
  if (!system.ok) return system;
  if (system.value.length === 0) {
    return { ok: false, message: "system is required" };
  }

  // `scope` is optional on the wire and falls back to the system name, as
  // `emitManifest` does (`answers.scope ?? answers.system ?? "app"`).
  //
  // ONE DELIBERATE DIVERGENCE: an EMPTY string falls back too. `??` does not
  // catch `""`, so handing bootstrap a blank scope would silently produce
  // `scope: generated-project` — a name nobody chose — where falling back to
  // the system name reproduces what the user actually ratified. The route
  // resolves the value before writing `answers.json`, so bootstrap never sees
  // the blank and the two cannot disagree.
  const rawScope =
    typeof body.scope === "string" && body.scope.trim().length > 0
      ? body.scope
      : system.value;
  if (body.scope !== undefined && body.scope !== null) {
    // Still type-checked when present: a non-string `scope` is a bad request,
    // not something to quietly replace with the system name.
    const provided = validateText(body.scope, "scope", MAX_SCOPE_INPUT_CHARS);
    if (!provided.ok) return provided;
  }
  const scope = validateText(rawScope, "scope", MAX_SCOPE_INPUT_CHARS);
  if (!scope.ok) return scope;

  if (body.architecture === undefined) {
    return { ok: false, message: "architecture is required" };
  }
  const architecture = validateText(
    body.architecture,
    "architecture",
    MAX_SYSTEM_CHARS,
  );
  if (!architecture.ok) return architecture;
  if (
    !(BOOTSTRAP_ARCHITECTURES as readonly string[]).includes(architecture.value)
  ) {
    return {
      ok: false,
      message: `architecture must be one of: ${BOOTSTRAP_ARCHITECTURES.join(", ")}`,
    };
  }

  if (!Array.isArray(body.contexts)) {
    return { ok: false, message: "contexts must be an array" };
  }
  if (body.contexts.length === 0) {
    // Bootstrap refuses this too ("No contexts were ratified"), but only after
    // the staging directory and the child process exist. Refusing here keeps a
    // known-empty request from costing a spawn.
    return {
      ok: false,
      message: "At least one ratified context is required",
    };
  }
  if (body.contexts.length > MAX_CONTEXTS) {
    return {
      ok: false,
      message: `contexts exceeds ${MAX_CONTEXTS} entries`,
    };
  }

  const contexts: ValidatedContext[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of body.contexts.entries()) {
    const validated = validateContext(raw, index);
    if (!validated.ok) return validated;
    if (seen.has(validated.value.name)) {
      // Two contexts of the same name collapse into one key in layout.yaml and
      // make every `depends_on` edge naming it ambiguous. Bootstrap does not
      // check this on the answers path; `detectWorkspaces` only checks the rows
      // IT proposed.
      return {
        ok: false,
        message: `Two contexts are called "${validated.value.name}" — names must be unique`,
      };
    }
    seen.add(validated.value.name);
    contexts.push(validated.value);
  }

  for (const context of contexts) {
    for (const target of context.dependsOn) {
      if (target === context.name) {
        return {
          ok: false,
          message: `"${context.name}" depends on itself`,
        };
      }
      if (!seen.has(target)) {
        return {
          ok: false,
          message: `"${context.name}" depends on "${target}", which is not one of the ratified contexts`,
        };
      }
    }
  }

  return {
    ok: true,
    value: {
      system: system.value,
      // Sanitized with the canonical helper, not merely validated: the value
      // that goes into `answers.json` is then byte-identical to what
      // `emitManifest` writes (`sanitizeScope` is idempotent), so the scope the
      // user ratified on S4 is provably the scope in `manifest.yaml`.
      scope: sanitizeScope(scope.value),
      architecture: architecture.value as BootstrapArchitecture,
      contexts,
    },
  };
}

/**
 * Cheap pre-check on the declared length. NOT sufficient on its own — a chunked
 * request omits the header entirely, which is exactly the shape a hostile
 * sender would use; {@link readCappedBody} is the enforcing read.
 */
function rejectOversizedRequest(request: NextRequest): NextResponse | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return NextResponse.json(
      { error: "Invalid Content-Length" },
      { status: 400 },
    );
  }
  if (Number(trimmed) > MAX_BOOTSTRAP_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413 },
    );
  }
  return null;
}

/**
 * Read the body with a hard byte ceiling that holds when Content-Length is
 * absent. `request.json()` buffers whatever arrives, so an endless chunked body
 * would allocate without bound before any validation ran. This counts as it
 * reads and stops at the cap, so a hostile body costs the cap, not the sender's
 * patience.
 *
 * A stream that ERRORS mid-read (a client that disconnects, a truncated upload)
 * is reported as `unreadable` rather than allowed to reject out of the handler,
 * where Next would turn a routine transport hiccup into a 500.
 */
async function readCappedBody(
  request: NextRequest,
): Promise<
  { kind: "ok"; text: string } | { kind: "too-large" } | { kind: "unreadable" }
> {
  const reader = request.body?.getReader();
  if (!reader) return { kind: "ok", text: "" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      return { kind: "unreadable" };
    }
    const { done, value } = chunk;
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BOOTSTRAP_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too-large" };
    }
    chunks.push(value);
  }
  return { kind: "ok", text: Buffer.concat(chunks).toString("utf8") };
}

interface ExecFailure extends Error {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: number | string;
  killed?: boolean;
}

/**
 * Promise wrapper over the callback form of `execFile`.
 *
 * Written out rather than `promisify(execFile)` so the subprocess stays a
 * mockable seam: `promisify` captures `execFile[util.promisify.custom]` at
 * module load, and a test that replaces `node:child_process.execFile` never
 * gets a look in. Argv array, no shell, no interpolated command string.
 */
function execFileAsync(
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error, stdout, stderr) => {
      if (error) {
        const failure = error as ExecFailure;
        failure.stdout ??= stdout;
        failure.stderr ??= stderr;
        reject(failure);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * argv for `hexagen bootstrap --root <root> --answers <file>`.
 *
 * A `.js` entry (`packages/sync/dist/cli.js`) is launched through the current
 * Node interpreter so `execFile` stays shell-free on posix; a `node_modules/.bin`
 * shim is executable on its own. Mirrors `hexagenScanArgv`, which does the same
 * for `scan` — deliberately NOT imported from there, because that helper hard-codes
 * the `scan --yes` argv and widening it would be an edit outside this fence.
 *
 * `--force` is deliberately absent. The staging root is freshly created and
 * empty, so bootstrap's overwrite refusal can never fire on a legitimate run —
 * and if it somehow does, that is a server fault worth a 500, not something to
 * suppress by clobbering whatever was there.
 */
function hexagenBootstrapArgv(
  bin: string,
  root: string,
  answersPath: string,
  execPath: string = process.execPath,
): { file: string; args: string[] } {
  const bootstrapArgs = ["bootstrap", "--root", root, "--answers", answersPath];
  if (/\.[cm]?js$/i.test(bin)) {
    return { file: execPath, args: [bin, ...bootstrapArgs] };
  }
  return { file: bin, args: bootstrapArgs };
}

/** Read a file bootstrap wrote, with a ceiling instead of an unbounded slurp. */
async function readCappedFile(filePath: string): Promise<Validated<string>> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_OUTPUT_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OUTPUT_FILE_BYTES) {
      return {
        ok: false,
        message: `${path.basename(filePath)} exceeded ${MAX_OUTPUT_FILE_BYTES.toLocaleString()} bytes`,
      };
    }
    return { ok: true, value: buffer.subarray(0, bytesRead).toString("utf8") };
  } finally {
    await handle.close();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The files this route returns, relative to the caller's project root.
 *
 * `layout.yaml` is written by bootstrap into the staging directory and then
 * discarded — see the module header for why a server-side layout would be a
 * lossy overwrite of the one S3 ratified.
 */
const RETURNED_FILES = [
  path.posix.join(".architecture", "manifest.yaml"),
  path.posix.join(".architecture", "arch-lint-baseline.json"),
] as const;

/**
 * Stage a temp project, run `hexagen bootstrap` against it, read back what it
 * wrote, and delete the staging directory.
 *
 * `answers.json` is written OUTSIDE the project root on purpose:
 * `detectWorkspaces(root)` reads whatever is under `root`, and the answers
 * document is an input to the run, not part of the project being described.
 */
async function runBootstrapCli(
  request: ValidatedRequest,
): Promise<BootstrapOutcome> {
  let workspaceRoot: string;
  try {
    workspaceRoot = findMonorepoRoot();
  } catch (error) {
    // A missing manifest anchor is a server packaging fault, not a bad body.
    return { kind: "failed", message: messageOf(error) };
  }

  const bin = resolveHexagenBin(workspaceRoot);
  if (bin === null) {
    return {
      kind: "unavailable",
      message:
        "The hexagen CLI is not available on this server, so the manifest could not be written here. Run `hexagen bootstrap` locally instead.",
    };
  }

  let staging: string;
  try {
    staging = await mkdtemp(path.join(tmpdir(), "hexagen-bootstrap-"));
  } catch (error) {
    return {
      kind: "failed",
      message: `Could not create a staging directory: ${messageOf(error)}`,
    };
  }

  try {
    const projectRoot = path.join(staging, "project");
    const answersPath = path.join(staging, "answers.json");

    try {
      await mkdir(projectRoot, { recursive: true });
      // Rebuilt object, not a spread: exactly the `BootstrapAnswers` fields,
      // nothing the client sent alongside them.
      //
      // `root` is required by `BootstrapContextAnswer` and is consumed ONLY by
      // `emitLayout`, whose output this route discards. It is pinned to "." so
      // the document is always well-formed (js-yaml refuses to dump an
      // `undefined` value, which would turn a valid request into a failed run)
      // without inventing a repository path the server cannot know.
      await writeFile(
        answersPath,
        `${JSON.stringify(
          {
            system: request.system,
            scope: request.scope,
            architecture: request.architecture,
            contexts: request.contexts.map((context) => ({
              name: context.name,
              include: true,
              type: context.type,
              root: ".",
              description: context.description,
              dependsOn: [...context.dependsOn],
            })),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } catch (error) {
      return {
        kind: "failed",
        message: `Could not stage the bootstrap answers: ${messageOf(error)}`,
      };
    }

    const { file, args } = hexagenBootstrapArgv(bin, projectRoot, answersPath);
    const timeout = bootstrapTimeoutMs();
    try {
      await execFileAsync(file, args, {
        cwd: projectRoot,
        timeout,
        maxBuffer: MAX_BOOTSTRAP_STDIO_BYTES,
      });
    } catch (error) {
      const failure = error as ExecFailure;
      if (failure.killed === true) {
        return {
          kind: "timed-out",
          message: `hexagen bootstrap did not finish within ${timeout}ms`,
        };
      }
      if (failure.code === MAXBUFFER_ERROR_CODE) {
        return {
          kind: "failed",
          message: `hexagen bootstrap produced more than ${MAX_BOOTSTRAP_STDIO_BYTES} bytes of output`,
        };
      }
      // `bootstrapCommand` prints `❌ <reason>` and sets exitCode 1 rather than
      // throwing. The reason can name absolute server paths, so it is LOGGED,
      // never returned (CWE-209).
      return {
        kind: "failed",
        message: `hexagen bootstrap exited ${String(failure.code ?? "non-zero")}: ${
          failure.stderr ? String(failure.stderr).trim() : messageOf(failure)
        }`,
      };
    }

    const files: BootstrapWrittenFile[] = [];
    for (const relative of RETURNED_FILES) {
      let contents: Validated<string>;
      try {
        contents = await readCappedFile(path.join(projectRoot, relative));
      } catch (error) {
        return {
          kind: "failed",
          message: `hexagen bootstrap did not write ${relative}: ${messageOf(error)}`,
        };
      }
      if (!contents.ok) return { kind: "failed", message: contents.message };
      files.push({ path: relative, contents: contents.value });
    }

    return { kind: "wrote", files };
  } finally {
    // Best-effort: a staging directory that outlives the request is a disk
    // nuisance, not a reason to fail a run that already produced the file.
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Outcome → HTTP.
 *
 * Every client-fixable rejection is a 400 and is answered before this mapper is
 * reached, so nothing here is a client error. `unavailable` is 503 because the
 * request was valid and this deployment simply cannot serve it (the CLI is not
 * in the image); `timed-out` is 504 for the same reason at a different layer.
 * `failed` is a genuine server fault: it is logged with the CLI's own words and
 * answered with a message that names no server path.
 */
function respond(outcome: BootstrapOutcome): NextResponse {
  if (outcome.kind === "wrote") {
    const body: ProjectBootstrapResponse = { files: outcome.files };
    return NextResponse.json(body, {
      // The response is derived per request from the posted answers; a cached
      // copy would hand one caller another caller's manifest.
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (outcome.kind === "unavailable") {
    logger.error("Bootstrap unavailable", { error: outcome.message });
    return NextResponse.json(
      { error: outcome.message, reason: "cli-unavailable" },
      { status: 503 },
    );
  }
  if (outcome.kind === "timed-out") {
    logger.error("Bootstrap timed out", { error: outcome.message });
    return NextResponse.json(
      {
        error: "Writing the manifest took too long and was stopped.",
        reason: "timed-out",
      },
      { status: 504 },
    );
  }
  logger.error("Bootstrap failed", { error: outcome.message });
  return NextResponse.json(
    { error: "Could not write the manifest.", reason: "bootstrap-failed" },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  const gate = guardMutation(request, BOOTSTRAP_MUTATION_GUARD);
  if (gate) return gate;

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;

  const capped = await readCappedBody(request);
  if (capped.kind === "too-large") {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413 },
    );
  }
  if (capped.kind === "unreadable") {
    return NextResponse.json(
      { error: "Could not read the request body" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(capped.text);
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const validated = validateBootstrapRequest(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  return respond(await runBootstrapCli(validated.value));
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with { system, scope, architecture, contexts }" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
