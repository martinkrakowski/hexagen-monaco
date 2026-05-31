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
  // requires env-setup — auto-resolves.
  const result = await useCase.execute({
    templateIds: ["bedrock-agentcore-services"],
    projectRoot,
  });
  return result.warnings;
}

const PORTS = "src/domain/ports/out";
const AGENTCORE = "src/infrastructure/agentcore";

describe("bedrock-agentcore-services template — emit shape (all services)", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-agentcore-svc-"));
    warnings = await install(root);
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits all three ports and their adapters plus the shared config files", async () => {
    for (const rel of [
      `${PORTS}/agent-memory.port.ts`,
      `${PORTS}/tool-gateway.port.ts`,
      `${PORTS}/agent-identity.port.ts`,
      `${AGENTCORE}/memory/agentcore-memory.adapter.ts`,
      `${AGENTCORE}/memory/memory-config.ts`,
      `${AGENTCORE}/gateway/agentcore-gateway.adapter.ts`,
      `${AGENTCORE}/gateway/mcp-tool-mapper.ts`,
      `${AGENTCORE}/identity/agentcore-identity.adapter.ts`,
      `${AGENTCORE}/identity/idp-bridge.ts`,
      "agentcore/agentcore-services.json",
      ".env.agentcore-services.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("keeps the domain ports framework-neutral (no AWS SDK import)", async () => {
    for (const port of [
      "agent-memory.port.ts",
      "tool-gateway.port.ts",
      "agent-identity.port.ts",
    ]) {
      const src = await read(root, `${PORTS}/${port}`);
      assert.ok(
        !/^import\b.*aws-sdk/m.test(src),
        `${port} must not import an AWS SDK`,
      );
    }
    const memPort = await read(root, `${PORTS}/agent-memory.port.ts`);
    assert.ok(memPort.includes("interface MemoryPort"));
  });

  it("marks the AWS adapters server-only and never hardcodes the region", async () => {
    const memory = await read(
      root,
      `${AGENTCORE}/memory/agentcore-memory.adapter.ts`,
    );
    assert.match(memory, /@hexagen-server-only/);
    assert.ok(memory.includes("CreateEventCommand"));
    assert.ok(memory.includes("RetrieveMemoryRecordsCommand"));
    // region passed only when explicitly resolved — never a literal
    assert.match(memory, /region\s*\?\s*\{\s*region\s*\}\s*:\s*\{\s*\}/);

    const identity = await read(
      root,
      `${AGENTCORE}/identity/agentcore-identity.adapter.ts`,
    );
    assert.match(identity, /@hexagen-server-only/);
    assert.match(identity, /region\s*\?\s*\{\s*region\s*\}\s*:\s*\{\s*\}/);
  });

  it("honours the port contracts: session-scoped recall and token-based exchange", async () => {
    // Memory: retrieve() must use its sessionId arg so recall stays session-keyed.
    const memory = await read(
      root,
      `${AGENTCORE}/memory/agentcore-memory.adapter.ts`,
    );
    assert.ok(memory.includes("scopedNamespace(sessionId)"));

    const identity = await read(
      root,
      `${AGENTCORE}/identity/agentcore-identity.adapter.ts`,
    );
    // Workload name is derived from the ARN, never passed through as-is.
    assert.ok(identity.includes("workloadNameFromArn"));
    // Outbound exchange passes the workload token, not the workload name.
    assert.ok(identity.includes("workloadIdentityToken: token"));
    assert.ok(
      !/GetResourceOauth2TokenCommand\(\{\s*workloadName/.test(identity),
    );
  });

  it("ships a dependency-free MCP gateway client mapping to the port", async () => {
    const gateway = await read(
      root,
      `${AGENTCORE}/gateway/agentcore-gateway.adapter.ts`,
    );
    assert.match(gateway, /@hexagen-server-only/);
    assert.ok(gateway.includes('"tools/list"'));
    assert.ok(gateway.includes('"tools/call"'));
    assert.ok(gateway.includes("fetch("));
    // documents the swap to the official SDK for full MCP handshakes
    assert.ok(gateway.includes("@modelcontextprotocol/sdk"));
  });

  it("interpolates memory + identity answers into config", async () => {
    const memCfg = await read(root, `${AGENTCORE}/memory/memory-config.ts`);
    assert.ok(memCfg.includes("longAndShortTerm"));
    assert.ok(memCfg.includes("SEMANTIC,SUMMARY"));
    assert.ok(!memCfg.includes("{memory_mode}"));
    assert.ok(!memCfg.includes("{memory_strategies}"));

    const bridge = await read(root, `${AGENTCORE}/identity/idp-bridge.ts`);
    assert.ok(bridge.includes('"cognito" as IdpProvider'));
    assert.ok(bridge.includes("cognito:groups"));
    assert.ok(bridge.includes("interface UserContext"));
    assert.ok(!bridge.includes("{identity_idp}"));
    // Local UserContext must mirror shared-types' shape exactly so the documented
    // import-swap compiles — guard against drift back to non-canonical names.
    assert.ok(bridge.includes("readonly id: string"));
    assert.ok(bridge.includes("readonly name: string"));
    assert.ok(!bridge.includes("userId"));
    assert.ok(!bridge.includes("displayName"));

    const services = JSON.parse(
      await read(root, "agentcore/agentcore-services.json"),
    );
    assert.equal(services.memory.retention, "longAndShortTerm");
    assert.equal(services.identity.idp, "cognito");
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});

describe("bedrock-agentcore-services template — gating (memory only)", () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-agentcore-svc-mem-"),
    );
    await install(root, { services: ["memory"] });
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits only the memory files, not gateway or identity", async () => {
    assert.ok(await exists(root, `${PORTS}/agent-memory.port.ts`));
    assert.ok(
      await exists(root, `${AGENTCORE}/memory/agentcore-memory.adapter.ts`),
    );
    for (const rel of [
      `${PORTS}/tool-gateway.port.ts`,
      `${PORTS}/agent-identity.port.ts`,
      `${AGENTCORE}/gateway/agentcore-gateway.adapter.ts`,
      `${AGENTCORE}/identity/idp-bridge.ts`,
    ]) {
      assert.ok(
        !(await exists(root, rel)),
        `${rel} must NOT emit when service disabled`,
      );
    }
  });
});
