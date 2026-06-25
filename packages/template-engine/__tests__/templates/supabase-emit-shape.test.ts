import { describe, it, beforeAll, afterAll } from "vitest";
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

// fileURLToPath handles Windows file:// URLs correctly (URL.pathname returns
// "/C:/foo" on Windows, which path.dirname mangles). Matches the pattern in
// src/infrastructure/template-registry.adapter.ts.
const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

// Question engine that returns each question's default and never blocks for input.
// We use this for end-to-end emit tests where the goal is shape verification,
// not answer-flow verification.
//
// Auto-typed questions MUST be short-circuited by AddTemplateUseCase before
// reaching the engine (see add-template.use-case.ts:107-116). If ask() is
// invoked for an auto question, that short-circuit has regressed — fail
// loudly so the bug isn't masked by silently falling back to a default.
function defaultsQuestionEngine(): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.type === "auto") {
        throw new Error(
          `defaultsQuestionEngine.ask invoked for auto-typed question '${q.id}' (derivedFrom=${q.derivedFrom}) — the use case should have resolved this from the source template's record without prompting`,
        );
      }
      if (q.type === "boolean") return q.default ?? false;
      if (q.type === "multiselect") return q.default ?? [];
      if (q.type === "select") return q.default ?? q.options[0] ?? "";
      if (q.type === "text") return q.default ?? "";
      const _ex: never = q;
      throw new Error(
        `unhandled question type: ${(_ex as { type: string }).type}`,
      );
    },
  };
}

async function freshProject(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-emit-test-"));
  return tmp;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("supabase template — storage-only emit shape (regression guard)", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await freshProject();
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    await useCase.execute({
      templateIds: ["supabase"],
      projectRoot,
      overrideAnswers: {
        // Supabase requires non-empty project_url / anon_key. Provide stubs.
        supabase: {
          project_url: "https://example.supabase.co",
          anon_key: "stub-anon-key",
          features: ["storage"],
          storage_buckets: "uploads",
          orm: false,
          type_gen: true,
          rls_examples: true,
          realtime_example: false,
        },
      },
    });
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("emits the storage + db core files", async () => {
    for (const p of [
      "src/infrastructure/supabase/client.ts",
      "src/infrastructure/supabase/server.ts",
      "src/infrastructure/supabase/admin.ts",
      "src/infrastructure/supabase/result.ts",
      "src/infrastructure/supabase/types/database.types.ts",
      "src/infrastructure/supabase/storage/upload.ts",
      "src/infrastructure/supabase/storage/index.ts",
      ".env.supabase.example",
    ]) {
      assert.ok(
        await exists(path.join(projectRoot, p)),
        `expected ${p} to be emitted`,
      );
    }
  });

  it("emits ZERO auth files (regression guard for the deferred PR #108 thread)", async () => {
    for (const forbidden of [
      "src/domain/value-objects/user-context.ts",
      "src/infrastructure/auth/mock-user.ts",
      "src/infrastructure/auth/session/session-manager.ts",
      "middleware.ts",
      "src/lib/auth/get-current-user.ts",
      "src/lib/auth/require-auth.ts",
      "app/api/auth/me/route.ts",
      ".env.auth.example",
      ".env.shared-types.example",
    ]) {
      assert.ok(
        !(await exists(path.join(projectRoot, forbidden))),
        `storage-only supabase must not emit ${forbidden}`,
      );
    }
  });

  it("does not auto-resolve auth-mock or shared-types into the install set", async () => {
    const config = await new FileSystemTemplateConfigStore().load(projectRoot);
    assert.equal(config.templates["auth-mock"], undefined);
    assert.equal(config.templates["shared-types"], undefined);
    assert.ok(config.templates["supabase"]);
  });
});

describe("supabase-auth template — full-stack emit", () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await freshProject();
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    await useCase.execute({
      templateIds: ["supabase-auth"],
      projectRoot,
      overrideAnswers: {
        supabase: {
          project_url: "https://example.supabase.co",
          anon_key: "stub-anon-key",
          features: ["storage"],
          storage_buckets: "uploads",
          orm: false,
          type_gen: true,
          rls_examples: true,
          realtime_example: false,
        },
      },
    });
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("auto-resolves supabase + shared-types + auth-mock + env-setup", async () => {
    const config = await new FileSystemTemplateConfigStore().load(projectRoot);
    for (const id of [
      "env-setup",
      "shared-types",
      "auth-mock",
      "supabase",
      "supabase-auth",
    ]) {
      assert.ok(config.templates[id], `expected ${id} in installed templates`);
    }
  });

  it("emits the supabase-auth files at the project root", async () => {
    for (const p of [
      "middleware.ts",
      "src/lib/auth/get-current-user.ts",
      "src/lib/auth/require-auth.ts",
      "app/api/auth/me/route.ts",
    ]) {
      assert.ok(
        await exists(path.join(projectRoot, p)),
        `expected ${p} to be emitted by supabase-auth`,
      );
    }
  });

  it("emits shared-types' UserContext + mock-user + session-manager", async () => {
    for (const p of [
      "src/domain/value-objects/user-context.ts",
      "src/infrastructure/auth/mock-user.ts",
      "src/infrastructure/auth/session/session-manager.ts",
    ]) {
      assert.ok(
        await exists(path.join(projectRoot, p)),
        `expected ${p} to be emitted by shared-types`,
      );
    }
  });
});
