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

async function install(templateId: string, projectRoot: string): Promise<void> {
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  // requires (shared-types, auth-mock, env-setup) auto-resolve and co-emit.
  await useCase.execute({ templateIds: [templateId], projectRoot });
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

// The three OAuth providers whose provider-user DTO was moved from the domain
// layer into the provider's infrastructure adapter directory.
const PROVIDERS = [
  { id: "google-oauth", dir: "google", file: "google-user" },
  { id: "github-oauth", dir: "github", file: "github-user" },
  { id: "microsoft-entra", dir: "entra", file: "entra-user" },
] as const;

describe("oauth provider templates — user DTO lives in infrastructure", () => {
  for (const { id, dir, file } of PROVIDERS) {
    describe(id, () => {
      let root: string;
      before(async () => {
        // Create the temp dir first so `root` is assigned before the throwable
        // install — the `after` hook then cleans up even if installation fails.
        root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-oauth-test-"));
        await install(id, root);
      });
      after(async () => {
        // `root` is unset if `before` failed before install — guard so cleanup
        // can't throw a confusing TypeError that masks the real failure.
        if (root) await fs.rm(root, { recursive: true, force: true });
      });

      it("emits the provider user DTO under src/infrastructure/auth", async () => {
        assert.ok(
          await exists(root, `src/infrastructure/auth/${dir}/${file}.ts`),
          "DTO should be an infrastructure adapter file",
        );
      });

      it("does NOT leak the provider user DTO into the domain layer", async () => {
        assert.strictEqual(
          await exists(root, `src/domain/value-objects/${file}.ts`),
          false,
          "provider wire-shape must not live in src/domain/",
        );
      });

      it("imports the DTO from the colocated infrastructure path", async () => {
        const adapter = await read(
          root,
          `src/infrastructure/auth/${dir}/${dir}-auth.adapter.ts`,
        );
        // Anchor to an actual import statement ending exactly at `./<file>`, so
        // the check can't pass on a comment or a longer specifier
        // (e.g. `./<file>-profile`). `file` is a fixed `<provider>-user` slug
        // with no regex metacharacters, so it needs no escaping.
        assert.match(
          adapter,
          new RegExp(
            String.raw`^\s*import\s+(?:type\s+)?\{[^}]+\}\s+from\s+["']\./${file}(?:\.js)?["'];?`,
            "m",
          ),
          "adapter should import the DTO via a colocated relative import (./<provider>-user)",
        );
      });
    });
  }
});
