import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import type {
  TemplateQuestion,
  QuestionAnswer,
} from "../../src/domain/index.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

function questionEngine(
  overrides: Record<string, QuestionAnswer> = {},
): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.id in overrides) return overrides[q.id]!;
      if (q.type === "auto")
        throw new Error(`auto ${q.id} resolved by use case`);
      if (q.type === "boolean") return q.default ?? false;
      if (q.type === "multiselect") return q.default ?? [];
      if (q.type === "select") return q.default ?? q.options[0] ?? "";
      if (q.type === "text") return q.default ?? "";
      const _ex: never = q;
      throw new Error(`unhandled type: ${(_ex as { type: string }).type}`);
    },
  };
}

async function read(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), "utf-8");
}

async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

async function install(
  projectRoot: string,
  overrides?: Record<string, QuestionAnswer>,
): Promise<string[]> {
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    questionEngine(overrides),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  // requires env-setup + error-handling — they auto-resolve.
  const result = await useCase.execute({
    templateIds: ["adobe-firefly-core"],
    projectRoot,
  });
  return result.warnings;
}

const PORTS = "src/domain/ports/out";
const ADOBE = "src/infrastructure/adobe";

describe("adobe-firefly-core template — emit shape (defaults: polling)", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-core-"));
    warnings = await install(root);
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the ports, adapters, and foundation modules", async () => {
    for (const rel of [
      `${PORTS}/firefly-auth.port.ts`,
      `${PORTS}/firefly-job.port.ts`,
      `${PORTS}/firefly-storage.port.ts`,
      `${ADOBE}/auth/ims-token-provider.adapter.ts`,
      `${ADOBE}/auth/smoke-token.ts`,
      `${ADOBE}/http/firefly-client.ts`,
      `${ADOBE}/jobs/job-result.ts`,
      `${ADOBE}/jobs/job-poller.ts`,
      `${ADOBE}/jobs/job-port.ts`,
      `${ADOBE}/storage/passthrough-storage.adapter.ts`,
      `${ADOBE}/errors/firefly-errors.ts`,
      `${ADOBE}/index.ts`,
      ".env.adobe.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("keeps the domain ports framework-neutral (no infrastructure or SDK import)", async () => {
    for (const port of [
      "firefly-auth.port.ts",
      "firefly-job.port.ts",
      "firefly-storage.port.ts",
    ]) {
      const src = await read(root, `${PORTS}/${port}`);
      assert.ok(
        !/^import\b.*infrastructure/m.test(src),
        `${port} must not import infrastructure`,
      );
      assert.ok(
        !/^import\b.*(aws-sdk|@adobe)/m.test(src),
        `${port} must not import an SDK`,
      );
    }
  });

  it("documents the job-port contract accurately: await resolves failed jobs", async () => {
    const jobPortDoc = await read(root, `${PORTS}/firefly-job.port.ts`);
    // contract must say a failed job RESOLVES (check status), not throws
    assert.ok(
      jobPortDoc.includes("RESOLVES to a `JobResult` for BOTH terminal states"),
    );
    assert.ok(
      !/failed[^\n]*surfaced as thrown/i.test(jobPortDoc),
      "stale 'failures are thrown' wording must be gone",
    );
  });

  it("marks every adobe adapter server-only (ADR-0037)", async () => {
    for (const rel of [
      `${ADOBE}/auth/ims-token-provider.adapter.ts`,
      `${ADOBE}/http/firefly-client.ts`,
      `${ADOBE}/jobs/job-port.ts`,
      `${ADOBE}/jobs/job-poller.ts`,
      `${ADOBE}/storage/passthrough-storage.adapter.ts`,
      `${ADOBE}/errors/firefly-errors.ts`,
      `${ADOBE}/index.ts`,
    ]) {
      const src = await read(root, rel);
      assert.match(
        src,
        /@hexagen-server-only/,
        `${rel} missing server-only marker`,
      );
    }
  });

  it("uses Server-to-Server auth, never JWT", async () => {
    const auth = await read(
      root,
      `${ADOBE}/auth/ims-token-provider.adapter.ts`,
    );
    assert.ok(auth.includes("client_credentials"));
    assert.ok(auth.includes("/ims/token/v3"));
    assert.ok(
      !auth.includes("@adobe/jwt-auth"),
      "must not use the retired JWT flow",
    );
  });

  it("interpolates the install answers", async () => {
    const client = await read(root, `${ADOBE}/http/firefly-client.ts`);
    assert.ok(client.includes('Number("60000")'));
    assert.ok(client.includes('Number("2")'));

    const auth = await read(
      root,
      `${ADOBE}/auth/ims-token-provider.adapter.ts`,
    );
    assert.ok(auth.includes("ims-na1.adobelogin.com"));

    const jobPort = await read(root, `${ADOBE}/jobs/job-port.ts`);
    assert.ok(jobPort.includes('const JOB_MODE = "polling"'));

    const storage = await read(
      root,
      `${ADOBE}/storage/passthrough-storage.adapter.ts`,
    );
    assert.ok(storage.includes("storage_mode=passthrough"));

    // no leftover placeholders anywhere
    for (const rel of [client, auth, jobPort, storage]) {
      assert.ok(
        !/\{(ims_region|job_mode|storage_mode|default_timeout_ms|max_retries)\}/.test(
          rel,
        ),
      );
    }
  });

  it("hardens runtime edges: portable AbortError + webhook fast-job race", async () => {
    const client = await read(root, `${ADOBE}/http/firefly-client.ts`);
    // Portable across edge runtimes/shims — match on name, not DOMException.
    assert.ok(
      client.includes('error instanceof Error && error.name === "AbortError"'),
    );
    assert.ok(!client.includes("instanceof DOMException"));

    // job-port buffers a webhook result that arrives before await() parks it,
    // supports multiple waiters per jobId, and times out (no hang/leak).
    const jobPort = await read(root, `${ADOBE}/jobs/job-port.ts`);
    assert.ok(jobPort.includes("settled"));
    assert.match(jobPort, /SCALING LIMIT/);
    assert.ok(jobPort.includes("Set<Waiter>"), "multiple waiters per jobId");
    assert.ok(jobPort.includes("did not arrive within"), "webhook TTL reject");

    // parseJobResult is total — never throws on a malformed body.
    const jobResult = await read(root, `${ADOBE}/jobs/job-result.ts`);
    assert.ok(jobResult.includes("safeParse"));
    // toJobHandle maps a submit response -> JobHandle for service adapters.
    assert.ok(jobResult.includes("export function toJobHandle"));
    const barrel = await read(root, `${ADOBE}/index.ts`);
    assert.ok(barrel.includes("toJobHandle"));

    // fetchStatus fails fast on a missing status URL instead of hitting BASE_URL.
    const poller = await read(root, `${ADOBE}/jobs/job-poller.ts`);
    assert.ok(poller.includes("Cannot check job"));

    // IMS token fetch is bounded by a timeout (like the REST client).
    const auth = await read(
      root,
      `${ADOBE}/auth/ims-token-provider.adapter.ts`,
    );
    assert.ok(auth.includes("AbortController"));
    assert.ok(auth.includes("IMS_TOKEN_TIMEOUT_MS"));
    assert.ok(auth.includes("clearTimeout"));
  });

  it("barrel and job-port never static-import the gated webhook file", async () => {
    // Doc-comment mentions are fine; what must not exist is a static import of the
    // gated module from an always-emitted file (engine constraint).
    const importsWebhook = /(?:import|from)\s+["'][^"']*webhook-verifier/;
    const barrel = await read(root, `${ADOBE}/index.ts`);
    assert.ok(
      !importsWebhook.test(barrel),
      "barrel must not import the gated webhook file",
    );
    const jobPort = await read(root, `${ADOBE}/jobs/job-port.ts`);
    assert.ok(
      !importsWebhook.test(jobPort),
      "always-emitted job-port must not import the gated file",
    );
  });

  it("omits the webhook verifier in polling mode", async () => {
    assert.ok(!(await exists(root, `${ADOBE}/jobs/webhook-verifier.ts`)));
  });

  it("marks credentials required in the env example", async () => {
    const env = await read(root, ".env.adobe.example");
    assert.match(env, /ADOBE_CLIENT_ID=\s*#\s*required/);
    assert.match(env, /ADOBE_CLIENT_SECRET=\s*#\s*required/);
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});

describe("adobe-firefly-core template — gating (webhook mode)", () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-core-wh-"));
    await install(root, { job_mode: "webhook" });
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the fail-closed webhook verifier and wires JOB_MODE", async () => {
    assert.ok(await exists(root, `${ADOBE}/jobs/webhook-verifier.ts`));
    const verifier = await read(root, `${ADOBE}/jobs/webhook-verifier.ts`);
    assert.match(verifier, /@hexagen-server-only/);
    assert.ok(verifier.includes("handleFireflyWebhook"));
    assert.ok(verifier.includes("timingSafeEqual"));
    // fail closed: no secret -> reject
    assert.ok(verifier.includes("if (!secret || !signature) return false"));
    // malformed payload / empty jobId -> settle nothing
    assert.ok(verifier.includes("if (!result.jobId) return { ok: false }"));
    // both terminal states RESOLVE the JobResult (transport-uniform with polling);
    // a completed-but-failed job is never rejected.
    assert.ok(verifier.includes("jobPort.resolveJob"));
    assert.ok(
      !verifier.includes("rejectJob"),
      "webhook must not reject a completed job",
    );
    // it imports the always-emitted job-port, not vice versa
    assert.ok(verifier.includes('from "./job-port"'));

    const jobPort = await read(root, `${ADOBE}/jobs/job-port.ts`);
    assert.ok(jobPort.includes('const JOB_MODE = "webhook"'));
    // Webhook await() rejects an empty jobId (no pending-map collisions).
    assert.ok(jobPort.includes("carried no job id"));
  });
});
