import { describe, it, expect } from "vitest";
import type { Transaction } from "@hexagen/transaction-system";
import type {
  MCPServerAdapterDependencies,
  TransactionLifecycleToolDependencies,
} from "../../../../src/infrastructure/adapters/mcp-server.types.js";
import { toolRegistry } from "../../../../src/infrastructure/adapters/tools/registry.js";

/**
 * HEX-019's stated benefit, exercised for item 6.5(b): "tools test against port
 * fakes; use-case impls can change without adapter recompiles."
 *
 * Every dependency below is a hand-written object literal satisfying an inbound
 * port. Not one use-case class is imported, and no transaction store is
 * constructed — an object literal cannot be assigned to a use-case class type,
 * since the classes keep `transactionManager` in a private constructor
 * property, so this file compiles only while the tool bag is typed on ports.
 * `typecheck:test` enforces that rather than leaving it asserted in prose.
 *
 * The bag is a Proxy that throws on any key outside the transaction-lifecycle
 * family. That is the isolation claim made mechanical: a family-(b) handler
 * that reached for a sibling family's dependency fails here rather than quietly
 * widening the seam item 6.5 is splitting one family at a time.
 *
 * Unlike the manifest-structure family, these four ports carry a `Result`
 * channel and their adapters branch on `result.success`, so the error arm is
 * exercised too — a fake returning `success: false` must surface as
 * `isError: true` with the error's message, not as a rendered payload.
 */

const TOUCHED: string[] = [];

const TX: Transaction = {
  id: "txn-1",
  intentId: "intent-1",
  status: "committed",
  createdAt: 0,
  updatedAt: 1,
  metadata: {},
};

const transactionLifecycleDeps: TransactionLifecycleToolDependencies = {
  getTransactionToolUseCase: {
    async execute(input) {
      TOUCHED.push(`get:${input.transaction_id}`);
      return {
        success: true,
        value: { transaction: { ...TX, status: "pending" }, found: true },
      };
    },
  },
  listTransactionsToolUseCase: {
    async execute(input) {
      TOUCHED.push(`list:${input?.status ?? "all"}`);
      return {
        success: true,
        value: {
          transactions: [TX],
          count: 1,
          filtered_by_status: input?.status,
        },
      };
    },
  },
  acceptTransactionToolUseCase: {
    async execute(input) {
      TOUCHED.push(`accept:${input.transaction_id}`);
      return {
        success: true,
        value: {
          transaction: TX,
          previous_status: "speculative",
          new_status: "committed",
        },
      };
    },
  },
  rejectTransactionToolUseCase: {
    async execute(input) {
      TOUCHED.push(`reject:${input.transaction_id}:${input.reason ?? "-"}`);
      return {
        success: true,
        value: {
          transaction: { ...TX, status: "rolled_back" },
          previous_status: "speculative",
          new_status: "rolled_back",
          reason: input.reason ?? "Rejected by AI agent",
        },
      };
    },
  },
};

/**
 * The four fields are all a transaction-lifecycle handler may read. Reaching
 * past them throws instead of yielding `undefined`, so an out-of-family access
 * is a loud failure rather than a `Cannot read properties of undefined`.
 */
function bagOf(
  deps: TransactionLifecycleToolDependencies,
): MCPServerAdapterDependencies {
  return new Proxy(deps, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof TransactionLifecycleToolDependencies];
      }
      throw new Error(
        `transaction-lifecycle tool reached outside its family: ${String(property)}`,
      );
    },
  }) as unknown as MCPServerAdapterDependencies;
}

const deps = bagOf(transactionLifecycleDeps);

const CASES: Array<{
  tool: string;
  args: Record<string, unknown>;
  touched: string;
  contains: string;
}> = [
  {
    tool: "hexagen_get_transaction",
    args: { transaction_id: "txn-1" },
    touched: "get:txn-1",
    contains: '"found": true',
  },
  {
    tool: "hexagen_list_transactions",
    args: { status: "pending" },
    touched: "list:pending",
    contains: '"count": 1',
  },
  {
    tool: "hexagen_accept_transaction",
    args: { transaction_id: "txn-1" },
    touched: "accept:txn-1",
    contains: '"new_status": "committed"',
  },
  {
    tool: "hexagen_reject_transaction",
    args: { transaction_id: "txn-1", reason: "conflicts with main" },
    touched: "reject:txn-1:conflicts with main",
    contains: '"reason": "conflicts with main"',
  },
];

describe("transaction-lifecycle tools driven by inbound-port fakes", () => {
  it("registers all four transaction-lifecycle tools", () => {
    // Anti-vacuity: the table below proves nothing if the registry stopped
    // carrying these names.
    const missing = CASES.filter(({ tool }) => !toolRegistry.has(tool)).map(
      ({ tool }) => tool,
    );

    expect(missing).toEqual([]);
    expect(CASES).toHaveLength(4);
  });

  for (const { tool, args, touched, contains } of CASES) {
    it(`${tool} calls only its inbound port`, async () => {
      TOUCHED.length = 0;
      const definition = toolRegistry.get(tool);
      expect(definition).toBeDefined();

      const result = await definition!.handler(args, deps);

      expect(TOUCHED).toEqual([touched]);
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain(contains);
    });
  }

  it("passes an absent status filter through as an unfiltered list", async () => {
    TOUCHED.length = 0;
    const result = await toolRegistry
      .get("hexagen_list_transactions")!
      .handler({}, deps);

    expect(TOUCHED).toEqual(["list:all"]);
    expect(result.isError).toBeUndefined();
  });

  it("surfaces a port's error arm as an MCP tool error", async () => {
    const failing = bagOf({
      ...transactionLifecycleDeps,
      acceptTransactionToolUseCase: {
        async execute() {
          return { success: false, error: new Error("Transaction not found") };
        },
      },
    });

    const result = await toolRegistry
      .get("hexagen_accept_transaction")!
      .handler({ transaction_id: "missing" }, failing);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Transaction not found");
  });
});
