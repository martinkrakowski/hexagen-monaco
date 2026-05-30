import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

const requireFromHere = createRequire(import.meta.url);
const tsxPkgJson = requireFromHere.resolve("tsx/package.json");
const tsxBin = JSON.parse(readFileSync(tsxPkgJson, "utf8")).bin as
  | string
  | { tsx: string };
const TSX_CLI = path.join(
  path.dirname(tsxPkgJson),
  typeof tsxBin === "string" ? tsxBin : tsxBin.tsx,
);

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

const ALWAYS_ON = [
  "src/infrastructure/logging/logger.ts",
  "src/infrastructure/logging/correlation.ts",
  "src/infrastructure/logging/context.ts",
  "src/infrastructure/logging/redact.ts",
  "src/infrastructure/logging/index.ts",
  "server/middleware/request-logger.ts",
  "app/api/health/route.ts",
  ".env.observability.example",
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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-observ-test-"));
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
  const result = await useCase.execute({
    templateIds: ["observability"],
    projectRoot,
    ...(answers ? { overrideAnswers: { observability: answers } } : {}),
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

describe("observability template — emit shape", () => {
  describe("defaults (auto, x-request-id, otel=false)", () => {
    let projectRoot: string;
    let warnings: string[];

    before(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits all always-on files", async () => {
      for (const p of ALWAYS_ON) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("does NOT emit the OTel files when otel=false", async () => {
      assert.equal(
        await exists(path.join(projectRoot, "instrumentation.ts")),
        false,
      );
      assert.equal(
        await exists(path.join(projectRoot, ".env.otel.example")),
        false,
      );
    });

    it("leaves no unresolved template variables", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates correlation_header and log_format", async () => {
      const corr = await read(
        projectRoot,
        "src/infrastructure/logging/correlation.ts",
      );
      const logger = await read(
        projectRoot,
        "src/infrastructure/logging/logger.ts",
      );
      // Wizard value is interpolated as the default, with a runtime env override.
      assert.ok(
        corr.includes('process.env.CORRELATION_ID_HEADER ?? "x-request-id"'),
      );
      assert.ok(logger.includes('process.env.LOG_FORMAT ?? "auto"'));
      assert.ok(!logger.includes("{log_format}"));
      assert.ok(!corr.includes("{correlation_header}"));
    });
  });

  describe("otel=true", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { otel: true });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the gated OTel bootstrap + env example", async () => {
      assert.ok(await exists(path.join(projectRoot, "instrumentation.ts")));
      assert.ok(await exists(path.join(projectRoot, ".env.otel.example")));
    });
  });

  // Run the emitted logging stack as a real subprocess to prove behaviour.
  describe("runtime behaviour", () => {
    let projectRoot: string;
    let out: {
      header: string;
      fromHeader: string;
      minted: string;
      redacted: Record<string, unknown>;
      redactedCycle: Record<string, unknown>;
      redactedErr: Record<string, unknown>;
      reqLog: Record<string, unknown>;
      firstLog: Record<string, unknown>;
      contextLog: Record<string, unknown>;
      ctxId: string;
      healthStatus: number;
      healthBody: { status: string; checks: Array<{ name: string }> };
    };

    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot);
      // Mark the temp project ESM so the driver's top-level await (the async
      // health route) is allowed — without it tsx compiles .ts as CommonJS.
      await fs.writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ type: "module" }),
        "utf8",
      );
      const driver = [
        'import { logger } from "./src/infrastructure/logging/logger";',
        'import { CORRELATION_ID_HEADER, getOrCreateCorrelationId } from "./src/infrastructure/logging/correlation";',
        'import { runWithContext, getRequestContext } from "./src/infrastructure/logging/context";',
        'import { redact } from "./src/infrastructure/logging/redact";',
        'import { requestLoggerMiddleware } from "./server/middleware/request-logger";',
        'import { GET } from "./app/api/health/route";',
        "const lines: string[] = [];",
        "const real = console.log;",
        "console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };",
        'logger.info({ a: 1, password: "topsecret" }, "hello");',
        'const ctxId = runWithContext({ requestId: "req-xyz", startedAt: 0 }, () => {',
        '  logger.info({ stage: "inner" }, "in-context");',
        "  return getRequestContext()?.requestId;",
        "});",
        "console.log = real;",
        "const healthRes = await GET();",
        "const healthBody = await healthRes.json();",
        "const cyc: Record<string, unknown> = { name: 'root', token: 'abc' };",
        "cyc.self = cyc;",
        "const redactedCycle = redact(cyc) as Record<string, unknown>;",
        "const redactedErr = redact({ err: new Error('boom'), when: new Date('2020-01-01T00:00:00.000Z'), token: 'x' }) as Record<string, unknown>;",
        "const reqLines: string[] = [];",
        "const realLog2 = console.log;",
        "console.log = (...a: unknown[]) => { reqLines.push(a.map(String).join(' ')); };",
        "const fakeRes = { statusCode: 200, setHeader() {}, _finish: null as null | (() => void), on(_e: string, cb: () => void) { this._finish = cb; } };",
        "requestLoggerMiddleware({ method: 'GET', url: '/users?token=abc&id=1', headers: {} }, fakeRes, () => {});",
        "if (fakeRes._finish) fakeRes._finish();",
        "console.log = realLog2;",
        "const reqLog = JSON.parse(reqLines[reqLines.length - 1]);",
        "real(JSON.stringify({",
        "  header: CORRELATION_ID_HEADER,",
        '  fromHeader: getOrCreateCorrelationId((n) => (n === CORRELATION_ID_HEADER ? "incoming" : null)),',
        "  minted: getOrCreateCorrelationId(() => null),",
        '  redacted: redact({ user: "alice", token: "abc" }),',
        "  redactedCycle,",
        "  redactedErr,",
        "  reqLog,",
        "  firstLog: JSON.parse(lines[0]),",
        "  contextLog: JSON.parse(lines[1]),",
        "  ctxId,",
        "  healthStatus: healthRes.status,",
        "  healthBody,",
        "}));",
      ].join("\n");
      await fs.writeFile(path.join(projectRoot, "driver.ts"), driver, "utf8");
      const stdout = execFileSync(process.execPath, [TSX_CLI, "driver.ts"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, NODE_ENV: "production", LOG_LEVEL: "info" },
      });
      out = JSON.parse(stdout);
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("uses the chosen correlation header and reads/mints ids", () => {
      assert.equal(out.header, "x-request-id");
      assert.equal(out.fromHeader, "incoming");
      assert.match(out.minted, /^[0-9a-f-]{36}$/);
      assert.notEqual(out.minted, "incoming");
    });

    it("emits structured JSON logs with redaction", () => {
      assert.equal(out.firstLog.level, "info");
      assert.equal(out.firstLog.message, "hello");
      assert.equal(out.firstLog.a, 1);
      assert.equal(out.firstLog.password, "[REDACTED]");
      assert.equal(out.redacted.user, "alice");
      assert.equal(out.redacted.token, "[REDACTED]");
    });

    it("replaces cyclic references with [CIRCULAR] instead of overflowing", () => {
      // Reaching this assertion at all proves redact() did not stack-overflow
      // on the self-referential object built in the driver.
      assert.equal(out.redactedCycle.token, "[REDACTED]");
      assert.equal(out.redactedCycle.self, "[CIRCULAR]");
    });

    it("logs the request path without the query string", () => {
      assert.equal(out.reqLog.type, "request");
      assert.equal(out.reqLog.path, "/users");
    });

    it("preserves Error and Date payloads instead of emptying them", () => {
      const err = out.redactedErr.err as Record<string, unknown>;
      assert.equal(err.name, "Error");
      assert.equal(err.message, "boom");
      assert.equal(typeof err.stack, "string");
      assert.equal(out.redactedErr.when, "2020-01-01T00:00:00.000Z");
      assert.equal(out.redactedErr.token, "[REDACTED]");
    });

    it("propagates the correlation id into logs via AsyncLocalStorage", () => {
      assert.equal(out.ctxId, "req-xyz");
      assert.equal(out.contextLog.requestId, "req-xyz");
    });

    it("serves /api/health with a 200 'ok' body", () => {
      assert.equal(out.healthStatus, 200);
      assert.equal(out.healthBody.status, "ok");
      assert.equal(out.healthBody.checks[0].name, "process");
    });
  });
});
