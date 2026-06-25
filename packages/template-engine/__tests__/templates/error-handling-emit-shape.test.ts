import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolve the tsx CLI from the repo so the emitted error-handling code can be
// run as a real subprocess from a temp project with no node_modules of its own.
const requireFromHere = createRequire(import.meta.url);
const tsxPkgJson = requireFromHere.resolve("tsx/package.json");
const tsxBin = JSON.parse(readFileSync(tsxPkgJson, "utf8")).bin as
  | string
  | { tsx: string };
const TSX_CLI = path.join(
  path.dirname(tsxPkgJson),
  typeof tsxBin === "string" ? tsxBin : tsxBin.tsx,
);
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import type {
  TemplateQuestion,
  QuestionAnswer,
  AnswerMap,
} from "../../src/domain/index.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

const ALWAYS_ON = [
  "src/shared/result.ts",
  "src/shared/errors/error-codes.ts",
  "src/domain/errors/domain.error.ts",
  "src/domain/errors/not-found.error.ts",
  "src/domain/errors/validation.error.ts",
  "src/domain/errors/authorization.error.ts",
  "src/application/errors/application.error.ts",
  "src/infrastructure/errors/infrastructure.error.ts",
  "src/infrastructure/errors/external-service.error.ts",
  "src/infrastructure/errors/llm-errors.ts",
  "server/middleware/error-handler.ts",
];

const REACT_FILES = [
  "app/components/ErrorBoundary.tsx",
  "app/components/ErrorFallback.tsx",
];

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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-errhandling-test-"));
}

async function install(
  projectRoot: string,
  answers?: AnswerMap,
): Promise<{ warnings: string[] }> {
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  // error-handling requires env-setup; resolve both, override per template.
  const result = await useCase.execute({
    templateIds: ["error-handling"],
    projectRoot,
    overrideAnswers: { "error-handling": answers ?? {} },
  });
  return { warnings: result.warnings };
}

async function read(projectRoot: string, rel: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, rel), "utf-8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("error-handling template — emit shape", () => {
  describe("defaults (rfc7807, react_boundary=true, sentry=false)", () => {
    let projectRoot: string;
    let warnings: string[];

    beforeAll(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the full always-on error layer", async () => {
      for (const p of ALWAYS_ON) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("emits the React boundary by default and not the sentry env file", async () => {
      for (const p of REACT_FILES) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
      assert.equal(
        await exists(path.join(projectRoot, ".env.sentry.example")),
        false,
      );
    });

    it("leaves no unresolved template variables (guards ts/tsx brace collisions)", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates http_mapping and compiles sentry=false off", async () => {
      const handler = await read(
        projectRoot,
        "server/middleware/error-handler.ts",
      );
      assert.ok(handler.includes("strategy: rfc7807-problem-json"));
      assert.ok(handler.includes('"false" === "true"'));
      assert.ok(!handler.includes("{http_mapping}"));
      assert.ok(!handler.includes("{sentry}"));
      // Domain context must be spread BEFORE the authoritative RFC 7807 fields
      // so it can't clobber `status`/`type`/etc. Assert both markers exist first
      // — otherwise a missing marker (indexOf === -1) would pass the order check.
      const ctxIdx = handler.indexOf("error.context");
      const typeIdx = handler.indexOf("type: TYPE_BASE_URL");
      assert.ok(ctxIdx >= 0, "expected the error.context spread to be present");
      assert.ok(typeIdx >= 0, "expected the type: field to be present");
      assert.ok(
        ctxIdx < typeIdx,
        "context spread must precede the standard fields",
      );
    });

    it("also installs its env-setup dependency", async () => {
      assert.ok(await exists(path.join(projectRoot, ".env.example")));
    });
  });

  describe("react_boundary=false", () => {
    let projectRoot: string;
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { react_boundary: false });
    });
    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("does NOT emit the React boundary components", async () => {
      for (const p of REACT_FILES) {
        assert.equal(await exists(path.join(projectRoot, p)), false, p);
      }
    });
  });

  describe("sentry=true", () => {
    let projectRoot: string;
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { sentry: true });
    });
    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the gated sentry env file and compiles the reporter on", async () => {
      assert.ok(await exists(path.join(projectRoot, ".env.sentry.example")));
      const handler = await read(
        projectRoot,
        "server/middleware/error-handler.ts",
      );
      assert.ok(handler.includes('"true" === "true"'));
    });
  });

  // Run the emitted error system as a real subprocess to prove behaviour (not
  // just file shape): RFC 7807 mapping, layer-aware client exposure, Result.
  describe("runtime behaviour", () => {
    let projectRoot: string;
    let out: {
      notFound: { status: number; body: Record<string, unknown> };
      external: { status: number; body: Record<string, unknown> };
      unknown: { status: number; body: Record<string, unknown> };
      nfIsDomain: boolean;
      okWorks: boolean;
      errWorks: boolean;
    };

    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot);
      const driver = [
        'import { handleError } from "./server/middleware/error-handler";',
        'import { NotFoundError } from "./src/domain/errors/not-found.error";',
        'import { ExternalServiceError } from "./src/infrastructure/errors/external-service.error";',
        'import { DomainError } from "./src/domain/errors/domain.error";',
        'import { ok, err, isOk, isErr } from "./src/shared/result";',
        'const notFound = handleError(new NotFoundError("Project", "1"), "/projects/1");',
        'const external = handleError(new ExternalServiceError("openai", 429));',
        'const unknown = handleError(new Error("boom"));',
        "console.log(JSON.stringify({",
        "  notFound, external, unknown,",
        '  nfIsDomain: new NotFoundError("Project", "1") instanceof DomainError,',
        "  okWorks: isOk(ok(5)),",
        '  errWorks: isErr(err(new Error("x"))),',
        "}));",
      ].join("\n");
      await fs.writeFile(path.join(projectRoot, "driver.ts"), driver, "utf8");
      const stdout = execFileSync(process.execPath, [TSX_CLI, "driver.ts"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      out = JSON.parse(stdout);
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("maps a domain NotFoundError to a 404 RFC 7807 body (context exposed)", () => {
      assert.equal(out.notFound.status, 404);
      assert.equal(out.notFound.body.code, "NOT_FOUND");
      assert.ok(String(out.notFound.body.type).endsWith("NOT_FOUND"));
      assert.equal(out.notFound.body.title, "NotFoundError");
      assert.equal(out.notFound.body.instance, "/projects/1");
      // Domain context is client-safe and surfaced.
      assert.equal(out.notFound.body.resource, "Project");
      assert.equal(out.notFound.body.id, "1");
      assert.ok(String(out.notFound.body.detail).includes("Project"));
    });

    it("does NOT leak infrastructure detail/context to the client", () => {
      assert.equal(out.external.status, 502);
      assert.equal(out.external.body.code, "EXTERNAL_SERVICE_FAILED");
      assert.equal(
        out.external.body.detail,
        "The request could not be completed.",
      );
      // The upstream service name must not reach the client.
      assert.ok(!JSON.stringify(out.external.body).includes("openai"));
      assert.equal(out.external.body.service, undefined);
    });

    it("maps an unknown error to a generic 500", () => {
      assert.equal(out.unknown.status, 500);
      assert.equal(out.unknown.body.code, "INTERNAL");
    });

    it("instanceof holds across the hierarchy, and Result works", () => {
      assert.equal(out.nfIsDomain, true);
      assert.equal(out.okWorks, true);
      assert.equal(out.errWorks, true);
    });
  });
});
