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

/** Question engine that returns manifest defaults, with optional per-id overrides. */
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
  // requires docker + env-setup — they auto-resolve.
  const result = await useCase.execute({
    templateIds: ["bedrock-agentcore-runtime"],
    projectRoot,
  });
  return result.warnings;
}

const AGENTCORE = "src/infrastructure/agentcore";

describe("bedrock-agentcore-runtime template — emit shape (defaults)", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-agentcore-test-"));
    warnings = await install(root);
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the container, HTTP contract, runtime, and AWS config files", async () => {
    for (const rel of [
      "Dockerfile.agentcore",
      `${AGENTCORE}/http/invocations.handler.ts`,
      `${AGENTCORE}/http/ping.handler.ts`,
      `${AGENTCORE}/http/server.ts`,
      `${AGENTCORE}/runtime/payload.ts`,
      `${AGENTCORE}/runtime/session.ts`,
      "agentcore/agentcore.json",
      "agentcore/aws-targets.json",
      "iam/agentcore-runtime-role.policy.json",
      ".env.agentcore.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("implements the AgentCore HTTP contract: ARM64 :8080, /ping, /invocations", async () => {
    const dockerfile = await read(root, "Dockerfile.agentcore");
    assert.match(dockerfile, /linux\/arm64/);
    assert.match(dockerfile, /EXPOSE 8080/);

    const ping = await read(root, `${AGENTCORE}/http/ping.handler.ts`);
    assert.ok(ping.includes("Healthy"));

    const server = await read(root, `${AGENTCORE}/http/server.ts`);
    assert.ok(server.includes('"/ping"'));
    assert.ok(server.includes('"/invocations"'));
    assert.match(server, /AGENTCORE_RUNTIME_PORT\s*\?\?\s*8080/);
  });

  it("keeps the inbound adapter depending only on the AgentRuntimePort", async () => {
    const handler = await read(
      root,
      `${AGENTCORE}/http/invocations.handler.ts`,
    );
    assert.ok(handler.includes("AgentRuntimePort"));
    assert.ok(handler.includes("invocationPayloadSchema"));
    // OAuth gate is env-driven (inbound_auth = OAuth sets the discovery URL).
    assert.ok(handler.includes("AGENTCORE_OAUTH_DISCOVERY_URL"));
    const payload = await read(root, `${AGENTCORE}/runtime/payload.ts`);
    assert.ok(payload.includes("interface AgentRuntimePort"));
  });

  it("seeds the observability correlation store without importing it", async () => {
    const session = await read(root, `${AGENTCORE}/runtime/session.ts`);
    assert.ok(session.includes("x-amzn-bedrock-agentcore-runtime-session-id"));
    assert.ok(session.includes("setCorrelationSeeder"));
    // soft dependency: must not statically import the observability template.
    // (Match real top-of-line imports only — the doc comment shows an example.)
    assert.ok(
      !/^import\b.*observability/m.test(session),
      "session.ts must not hard-import observability (soft dep)",
    );
  });

  it("interpolates answers into agentcore.json and the IAM policy", async () => {
    const config = JSON.parse(await read(root, "agentcore/agentcore.json"));
    assert.equal(config.name, "hexagen-agent");
    assert.equal(config.region, "us-west-2");
    assert.equal(config.protocol, "HTTP");
    assert.equal(config.container.port, 8080);

    const policy = JSON.parse(
      await read(root, "iam/agentcore-runtime-role.policy.json"),
    );
    const bedrock = policy.Statement.find(
      (s: { Sid: string }) => s.Sid === "BedrockModelInvocation",
    );
    assert.ok(
      bedrock.Resource.some((r: string) => r.includes("us-west-2")),
      "region-scoped bedrock ARN",
    );
  });

  it("emits the deploy workflow (deploy_ci default true) but no CDK stack (provision default agentcore-cli)", async () => {
    assert.ok(
      await exists(root, ".github/workflows/deploy-agentcore.yml"),
      "deploy_ci=true must emit the workflow",
    );
    assert.ok(
      !(await exists(root, "infra/agentcore-stack.ts")),
      "provision=agentcore-cli must NOT emit the CDK stack",
    );
    const workflow = await read(root, ".github/workflows/deploy-agentcore.yml");
    // ${{ }} GitHub expressions pass through interpolation untouched
    assert.ok(workflow.includes("${{ secrets.AWS_DEPLOY_ROLE_ARN }}"));
    // bare {agent_name} resolved
    assert.ok(workflow.includes('ECR_REPOSITORY: "hexagen-agent"'));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});

describe("bedrock-agentcore-runtime template — gating (cdk, no CI)", () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-agentcore-cdk-"));
    await install(root, { provision: "cdk", deploy_ci: false });
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the CDK stack and omits the deploy workflow", async () => {
    assert.ok(
      await exists(root, "infra/agentcore-stack.ts"),
      "provision=cdk must emit the CDK stack",
    );
    assert.ok(
      !(await exists(root, ".github/workflows/deploy-agentcore.yml")),
      "deploy_ci=false must NOT emit the workflow",
    );
    const stack = await read(root, "infra/agentcore-stack.ts");
    assert.ok(stack.includes("AgentCoreStack"));
    assert.ok(stack.includes('repositoryName: "hexagen-agent"'));
  });
});
