import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  analyzePortFile,
  generateUseCaseFromPort,
  generateAdapterFromPort,
  resetPortAnalysisMemo,
  type PortAnalysisResult,
  type UseCaseOutPort,
} from "../../src/generators/port-analyzer.js";

/**
 * Edge cases hardened after the PR #251 review: collision-safe imports/params and
 * relative-import rewriting in generateUseCaseFromPort / generateAdapterFromPort.
 */

const inPort = (
  over: Partial<PortAnalysisResult> = {},
): PortAnalysisResult => ({
  interfaceName: "PlaceOrderPort",
  methods: [
    {
      name: "execute",
      parameters: [{ name: "input", type: "string", isOptional: false }],
      returnType: "Promise<void>",
      isAsync: true,
    },
  ],
  imports: [],
  filePath:
    "/proj/packages/orders/src/application/ports/in/PlaceOrder.in-port.ts",
  ...over,
});

const out = (
  interfaceName: string,
  paramName: string,
  importSpecifier: string,
): UseCaseOutPort => ({ interfaceName, paramName, importSpecifier });

const IN_SPEC = "../ports/in/PlaceOrder.in-port.js";

describe("generateUseCaseFromPort — collision & identifier safety (#251)", () => {
  it("collapses exact-duplicate out-port deps to a single import + param", () => {
    const code = generateUseCaseFromPort(
      inPort(),
      "PlaceOrder",
      [
        out("OrderRepoPort", "orderRepo", "../ports/out/OrderRepo.out-port.js"),
        out("OrderRepoPort", "orderRepo", "../ports/out/OrderRepo.out-port.js"),
      ],
      IN_SPEC,
    );
    const importCount = (
      code.match(/import type \{ OrderRepoPort \} from/g) ?? []
    ).length;
    assert.strictEqual(importCount, 1, "one import for the duplicate dep");
    const paramCount = (code.match(/private readonly orderRepo:/g) ?? [])
      .length;
    assert.strictEqual(paramCount, 1, "one constructor param for the dup dep");
  });

  it("aliases an out-port whose interface name collides with the in-port (different module)", () => {
    const code = generateUseCaseFromPort(
      inPort({ interfaceName: "ChargeCardPort" }),
      "ChargeCard",
      [
        out(
          "ChargeCardPort",
          "chargeCard",
          "../ports/out/ChargeCard.out-port.js",
        ),
      ],
      "../ports/in/ChargeCard.in-port.js",
    );
    assert.match(code, /export class ChargeCard implements ChargeCardPort\b/);
    assert.match(
      code,
      /import type \{ ChargeCardPort as ChargeCardPort_2 \} from '\.\.\/ports\/out\/ChargeCard\.out-port\.js'/,
      "out-port import is aliased to avoid the duplicate identifier",
    );
    assert.match(
      code,
      /private readonly chargeCard: ChargeCardPort_2/,
      "constructor injects the aliased type",
    );
  });

  it("disambiguates distinct out-ports that derive the same param name", () => {
    const code = generateUseCaseFromPort(
      inPort(),
      "PlaceOrder",
      [
        out("ARepoPort", "repo", "../ports/out/A.out-port.js"),
        out("BRepoPort", "repo", "../ports/out/B.out-port.js"),
      ],
      IN_SPEC,
    );
    assert.match(code, /private readonly repo: ARepoPort/);
    assert.match(code, /private readonly repo2: BRepoPort/);
  });

  it("escapes reserved-word constructor parameter names", () => {
    const code = generateUseCaseFromPort(
      inPort(),
      "PlaceOrder",
      [out("ClassPort", "class", "../ports/out/Class.out-port.js")],
      IN_SPEC,
    );
    assert.match(
      code,
      /private readonly class_: ClassPort/,
      "`class` param is escaped to `class_`",
    );
    assert.doesNotMatch(code, /private readonly class:/);
  });

  it("rewrites the in-port's own relative imports to the use-case location", () => {
    const code = generateUseCaseFromPort(
      inPort({
        imports: [
          {
            moduleSpecifier: "./order.dto.js", // relative to ports/in/
            namedImports: ["OrderDto"],
            isTypeOnly: true,
          },
          {
            moduleSpecifier: "@acme/shared", // bare → unchanged
            namedImports: ["Result"],
            isTypeOnly: true,
          },
        ],
      }),
      "PlaceOrder",
      [],
      IN_SPEC,
      "/proj/packages/orders/src/application/use-cases/PlaceOrder.use-case.ts",
    );
    assert.match(
      code,
      /import type \{ OrderDto \} from '\.\.\/ports\/in\/order\.dto\.js'/,
      "relative import rewritten from ports/in to use-cases",
    );
    assert.match(
      code,
      /import type \{ Result \} from '@acme\/shared'/,
      "bare specifier left unchanged",
    );
  });
});

describe("generateAdapterFromPort — relative import rewrite (#251)", () => {
  it("rewrites a port's relative import to the adapter location", () => {
    const analysis = inPort({
      interfaceName: "OrderRepoPort",
      filePath:
        "/proj/packages/orders/src/application/ports/out/OrderRepo.out-port.ts",
      imports: [
        {
          moduleSpecifier: "./order.entity.js", // relative to ports/out/
          namedImports: ["Order"],
          isTypeOnly: true,
        },
      ],
    });
    const code = generateAdapterFromPort(
      analysis,
      "OrderRepoAdapter",
      "../../application/ports/out/OrderRepo.out-port.js",
      "/proj/packages/orders/src/infrastructure/adapters/OrderRepo.adapter.ts",
    );
    assert.match(
      code,
      /import type \{ Order \} from '\.\.\/\.\.\/application\/ports\/out\/order\.entity\.js'/,
      "relative entity import rewritten to the adapter's directory",
    );
  });
});

// -----------------------------------------------------------------------------
// Per-run memoization of analyzePortFile (#907). Content-keyed per the
// orchestrator corrections: rewriting a file between two calls returns the new
// analysis, and a file that appears after a first `null` is analysed. The memo
// only serves identical path + content; null for a missing/unreadable file is
// never memoized.
// -----------------------------------------------------------------------------

const PAYMENT_PORT_V1 = `import type { Money } from "./money.js";

export interface PaymentPort {
  charge(amount: Money): Promise<string>;
  refund(id: string): Promise<void>;
}
`;

const PAYMENT_PORT_V2 = `export interface PaymentPortV2 {
  settle(amount: number): string;
}
`;

const REPO_PORT_TS = `import type { Order } from "../../../domain/entities/Order.js";

export interface RepoPort {
  count(): Promise<number>;
  save(order: string): Promise<void>;
}
`;

describe("analyzePortFile — per-run memoization (#907)", () => {
  async function tempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-portan-"));
  }

  it("returns deep-equal results for repeated calls on the same path (R3)", async () => {
    const dir = await tempDir();
    try {
      const portPath = path.join(dir, "Payment.in-port.ts");
      await fs.writeFile(portPath, PAYMENT_PORT_V1, "utf8");
      const first = analyzePortFile(portPath);
      const second = analyzePortFile(portPath);
      assert.ok(first, "first analysis should succeed");
      assert.deepStrictEqual(second, first);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a nonexistent path on every call (R3)", async () => {
    const dir = await tempDir();
    try {
      const missing = path.join(dir, "missing.in-port.ts");
      assert.strictEqual(analyzePortFile(missing), null);
      assert.strictEqual(analyzePortFile(missing), null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("re-analyses a port file rewritten within the same run (content-keyed memo)", async () => {
    const dir = await tempDir();
    try {
      const portPath = path.join(dir, "Payment.in-port.ts");
      await fs.writeFile(portPath, PAYMENT_PORT_V1, "utf8");
      const v1 = analyzePortFile(portPath);
      assert.ok(v1);
      assert.strictEqual(v1.interfaceName, "PaymentPort");

      await fs.writeFile(portPath, PAYMENT_PORT_V2, "utf8");
      const v2 = analyzePortFile(portPath);
      assert.ok(v2, "a rewritten file must return a fresh analysis");
      assert.strictEqual(v2.interfaceName, "PaymentPortV2");
      assert.notStrictEqual(v2.interfaceName, v1.interfaceName);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("analyses a file that appears after an earlier null", async () => {
    const dir = await tempDir();
    try {
      const portPath = path.join(dir, "later.in-port.ts");
      assert.strictEqual(analyzePortFile(portPath), null);
      await fs.writeFile(portPath, PAYMENT_PORT_V1, "utf8");
      const analysis = analyzePortFile(portPath);
      assert.ok(analysis, "a file created after a null must be analysed");
      assert.strictEqual(analysis.interfaceName, "PaymentPort");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("resetPortAnalysisMemo clears the memo (R4/no leakage)", async () => {
    const dir = await tempDir();
    try {
      const portPath = path.join(dir, "Payment.in-port.ts");
      await fs.writeFile(portPath, PAYMENT_PORT_V1, "utf8");
      const before = analyzePortFile(portPath);
      resetPortAnalysisMemo();
      const after = analyzePortFile(portPath);
      assert.ok(after, "analysis still works after reset");
      assert.deepStrictEqual(after, before);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("feeds a real on-disk analysis into scaffold generation (R5)", async () => {
    const dir = await tempDir();
    try {
      const portPath = path.join(
        dir,
        "src/application/ports/out/Repo.out-port.ts",
      );
      await fs.mkdir(path.dirname(portPath), { recursive: true });
      await fs.writeFile(portPath, REPO_PORT_TS, "utf8");
      const analysis = analyzePortFile(portPath);
      assert.ok(analysis);
      assert.strictEqual(analysis.interfaceName, "RepoPort");

      const adapterCode = generateAdapterFromPort(
        analysis,
        "RepoAdapter",
        "../../application/ports/out/Repo.out-port.js",
        path.join(dir, "src/infrastructure/adapters/Repo.adapter.ts"),
      );
      assert.ok(
        adapterCode.includes("export class RepoAdapter implements RepoPort"),
        "adapter scaffold implements the analyzed out-port interface",
      );
      assert.ok(
        adapterCode.includes("async count(): Promise<number>"),
        "count method scaffold present",
      );
      assert.ok(
        adapterCode.includes("async save(order: string): Promise<void>"),
        "save method scaffold present",
      );
      // The port's own relative import is rewritten relative to the adapter dir.
      assert.ok(
        adapterCode.includes(
          "import type { Order } from '../../domain/entities/Order.js';",
        ),
        "entity import rewritten to the adapter's directory",
      );

      const useCaseCode = generateUseCaseFromPort(
        analysis,
        "ListOrders",
        [],
        "../ports/out/Repo.out-port.js",
        path.join(dir, "src/application/use-cases/ListOrders.use-case.ts"),
      );
      assert.ok(
        useCaseCode.includes("export class ListOrders implements RepoPort"),
        "use-case scaffold implements the analyzed out-port interface",
      );
      assert.ok(
        useCaseCode.includes("async count(): Promise<number>"),
        "count method scaffold present in use-case",
      );
      assert.ok(
        useCaseCode.includes("async save(order: string): Promise<void>"),
        "save method scaffold present in use-case",
      );
      assert.ok(
        useCaseCode.includes(
          "import type { Order } from '../../domain/entities/Order.js';",
        ),
        "entity import rewritten to the use-case directory",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
