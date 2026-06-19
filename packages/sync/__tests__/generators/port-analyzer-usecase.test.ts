import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  generateUseCaseFromPort,
  generateAdapterFromPort,
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
