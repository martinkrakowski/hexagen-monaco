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

function defaultsQuestionEngine(): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.type === "auto") {
        throw new Error(
          `auto question ${q.id} should be resolved by the use case`,
        );
      }
      if (q.type === "boolean") return q.default ?? false;
      if (q.type === "multiselect") return q.default ?? [];
      if (q.type === "select") return q.default ?? q.options[0] ?? "";
      if (q.type === "text") return q.default ?? "";
      const _ex: never = q;
      throw new Error(`unhandled type: ${(_ex as { type: string }).type}`);
    },
  };
}

async function freshProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-langgraph-test-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("langgraph template — gated outputs reflect the install answers", () => {
  describe("minimal install (defaults: local, memory checkpointer, simple-chain, no streaming, no HITL)", () => {
    let projectRoot: string;

    before(async () => {
      projectRoot = await freshProject();
      const useCase = new AddTemplateUseCase(
        new FileSystemTemplateRegistry(TEMPLATES_DIR),
        defaultsQuestionEngine(),
        new FileSystemFileEmitter(TEMPLATES_DIR),
        new FileSystemTemplateConfigStore(),
      );
      await useCase.execute({ templateIds: ["langgraph"], projectRoot });
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the always-on core files", async () => {
      for (const p of [
        "src/domain/ports/out/agent-graph.port.ts",
        "src/infrastructure/langgraph/state/graph-state.ts",
        "src/infrastructure/langgraph/edges/routing.ts",
        "src/infrastructure/langgraph/checkpointers/memory-checkpointer.ts",
        "src/infrastructure/langgraph/checkpointers/index.ts",
        "src/infrastructure/langgraph/adapters/langgraph.adapter.ts",
        "src/infrastructure/langgraph/index.ts",
        "app/api/agent/invoke/route.ts",
        ".env.langgraph.example",
      ]) {
        assert.ok(
          await exists(path.join(projectRoot, p)),
          `expected ${p} to be emitted`,
        );
      }
    });

    it("emits the simple-chain nodes + graph by default", async () => {
      for (const p of [
        "src/infrastructure/langgraph/nodes/input-processor.node.ts",
        "src/infrastructure/langgraph/nodes/llm-call.node.ts",
        "src/infrastructure/langgraph/nodes/output-formatter.node.ts",
        "src/infrastructure/langgraph/graphs/simple-chain.graph.ts",
      ]) {
        assert.ok(
          await exists(path.join(projectRoot, p)),
          `expected ${p} to be emitted`,
        );
      }
    });

    it("does NOT emit research-agent nodes or graph", async () => {
      for (const p of [
        "src/infrastructure/langgraph/nodes/planner.node.ts",
        "src/infrastructure/langgraph/nodes/researcher.node.ts",
        "src/infrastructure/langgraph/nodes/synthesiser.node.ts",
        "src/infrastructure/langgraph/graphs/research-agent.graph.ts",
      ]) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted with graph_type=simple-chain`,
        );
      }
    });

    it("does NOT emit non-memory checkpointers", async () => {
      for (const p of [
        "src/infrastructure/langgraph/checkpointers/supabase-checkpointer.ts",
        "src/infrastructure/langgraph/checkpointers/redis-checkpointer.ts",
        "src/infrastructure/langgraph/checkpointers/postgres-checkpointer.ts",
      ]) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted with checkpointing=memory`,
        );
      }
    });

    it("does NOT emit streaming or HITL files", async () => {
      for (const p of [
        "src/infrastructure/langgraph/streaming/token-stream.ts",
        "app/api/agent/stream/route.ts",
        "src/infrastructure/langgraph/nodes/human-review.node.ts",
        "app/api/agent/resume/route.ts",
      ]) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted with streaming=false, human_in_loop=false`,
        );
      }
    });

    it("interpolates {graph_type} into the adapter import", async () => {
      const adapter = await fs.readFile(
        path.join(
          projectRoot,
          "src/infrastructure/langgraph/adapters/langgraph.adapter.ts",
        ),
        "utf-8",
      );
      assert.ok(
        adapter.includes('from "../graphs/simple-chain.graph"'),
        "adapter should import from simple-chain.graph for minimal install",
      );
      assert.ok(
        !adapter.includes("{graph_type}"),
        "{graph_type} placeholder should be resolved by interpolation",
      );
    });
  });

  describe("full install (cloud, supabase checkpointer, research-agent, streaming, HITL)", () => {
    let projectRoot: string;

    before(async () => {
      projectRoot = await freshProject();
      const useCase = new AddTemplateUseCase(
        new FileSystemTemplateRegistry(TEMPLATES_DIR),
        defaultsQuestionEngine(),
        new FileSystemFileEmitter(TEMPLATES_DIR),
        new FileSystemTemplateConfigStore(),
      );
      await useCase.execute({
        templateIds: ["langgraph"],
        projectRoot,
        overrideAnswers: {
          langgraph: {
            deployment: "langgraph-cloud",
            checkpointing: "supabase",
            streaming: true,
            graph_type: "research-agent",
            human_in_loop: true,
          },
        },
      });
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the research-agent nodes + graph", async () => {
      for (const p of [
        "src/infrastructure/langgraph/nodes/planner.node.ts",
        "src/infrastructure/langgraph/nodes/researcher.node.ts",
        "src/infrastructure/langgraph/nodes/synthesiser.node.ts",
        "src/infrastructure/langgraph/graphs/research-agent.graph.ts",
      ]) {
        assert.ok(
          await exists(path.join(projectRoot, p)),
          `expected ${p} to be emitted`,
        );
      }
    });

    it("does NOT emit simple-chain nodes or graph", async () => {
      for (const p of [
        "src/infrastructure/langgraph/nodes/input-processor.node.ts",
        "src/infrastructure/langgraph/nodes/llm-call.node.ts",
        "src/infrastructure/langgraph/nodes/output-formatter.node.ts",
        "src/infrastructure/langgraph/graphs/simple-chain.graph.ts",
      ]) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted with graph_type=research-agent`,
        );
      }
    });

    it("emits the supabase checkpointer (and not the others)", async () => {
      assert.ok(
        await exists(
          path.join(
            projectRoot,
            "src/infrastructure/langgraph/checkpointers/supabase-checkpointer.ts",
          ),
        ),
      );
      for (const p of [
        "src/infrastructure/langgraph/checkpointers/redis-checkpointer.ts",
        "src/infrastructure/langgraph/checkpointers/postgres-checkpointer.ts",
      ]) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted with checkpointing=supabase`,
        );
      }
    });

    it("emits streaming + HITL files", async () => {
      for (const p of [
        "src/infrastructure/langgraph/streaming/token-stream.ts",
        "app/api/agent/stream/route.ts",
        "src/infrastructure/langgraph/nodes/human-review.node.ts",
        "app/api/agent/resume/route.ts",
      ]) {
        assert.ok(
          await exists(path.join(projectRoot, p)),
          `expected ${p} to be emitted`,
        );
      }
    });

    it("interpolates the research-agent path into the adapter import", async () => {
      const adapter = await fs.readFile(
        path.join(
          projectRoot,
          "src/infrastructure/langgraph/adapters/langgraph.adapter.ts",
        ),
        "utf-8",
      );
      assert.ok(
        adapter.includes('from "../graphs/research-agent.graph"'),
        "adapter should import from research-agent.graph",
      );
    });
  });
});
