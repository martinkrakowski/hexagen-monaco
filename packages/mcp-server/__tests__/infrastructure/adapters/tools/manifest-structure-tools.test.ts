import { describe, it, expect } from "vitest";
import type {
  MCPServerAdapterDependencies,
  ManifestStructureToolDependencies,
} from "../../../../src/infrastructure/adapters/mcp-server.types.js";
import { toolRegistry } from "../../../../src/infrastructure/adapters/tools/registry.js";

/**
 * HEX-019's stated benefit, exercised: "tools test against port fakes; use-case
 * impls can change without adapter recompiles."
 *
 * Every dependency below is a hand-written object literal satisfying an inbound
 * port. Not one use-case class is imported, and an object literal cannot even
 * be assigned to a use-case class type — the classes keep their collaborators
 * in private constructor properties — so this file compiles only while the tool
 * bag is typed on ports. That claim is enforced rather than asserted: this PR
 * adds the `typecheck:test` script the package was missing, so CI now
 * type-checks `__tests__/` here as it does elsewhere.
 *
 * The bag is a Proxy that throws on any key outside the manifest-structure
 * family. That is the isolation claim made mechanical: a family-(a) handler
 * that reached for a sibling family's dependency fails here rather than
 * quietly widening the seam that item 6.5 is splitting one family at a time.
 */

const TOUCHED: string[] = [];

const manifestStructureDeps: ManifestStructureToolDependencies = {
  createContextToolUseCase: {
    async execute(input) {
      TOUCHED.push(`createContext:${input.name}:${input.type}`);
      return {
        dryRun: false,
        registered: true,
        alreadyExisted: false,
        message: `created ${input.name}`,
      };
    },
  },
  removeContextToolUseCase: {
    async execute(input) {
      TOUCHED.push(`removeContext:${input.context_name}`);
      return {
        dryRun: false,
        removed: true,
        message: `removed ${input.context_name}`,
      };
    },
  },
  createPortToolUseCase: {
    async execute(input) {
      TOUCHED.push(`createPort:${input.port_name}:${input.type}`);
      return {
        dryRun: false,
        fileCreated: "port.ts",
        message: `created ${input.port_name}`,
      };
    },
  },
  removePortToolUseCase: {
    async execute(input) {
      TOUCHED.push(`removePort:${input.port_name}:${input.direction}`);
      return {
        dryRun: false,
        removed: true,
        message: `removed ${input.port_name}`,
      };
    },
  },
  createAdapterToolUseCase: {
    async execute(input) {
      TOUCHED.push(`createAdapter:${input.port_name}`);
      return {
        dryRun: false,
        fileCreated: "adapter.ts",
        message: `created adapter for ${input.port_name}`,
      };
    },
  },
  addDependencyToolUseCase: {
    async execute(input) {
      TOUCHED.push(
        `addDependency:${input.sourceModule}->${input.targetModule}`,
      );
      return { dryRun: false, updated: true, message: "dependency updated" };
    },
  },
  diffManifestToolUseCase: {
    async execute(input) {
      TOUCHED.push(`diffManifest:${input?.compare_source ?? "git_head"}`);
      return {
        success: true,
        value: {
          diff: {
            added: [],
            removed: [],
            modified: [],
          } as never,
          formatted: "no changes",
        },
      };
    },
  },
};

/**
 * The seven fields are all a manifest-structure handler may read. Reaching past
 * them throws instead of yielding `undefined`, so an out-of-family access is a
 * loud failure rather than a `Cannot read properties of undefined`.
 */
const deps = new Proxy(manifestStructureDeps, {
  get(target, property) {
    if (property in target) {
      return target[property as keyof ManifestStructureToolDependencies];
    }
    throw new Error(
      `manifest-structure tool reached outside its family: ${String(property)}`,
    );
  },
}) as unknown as MCPServerAdapterDependencies;

const CASES: Array<{
  tool: string;
  args: Record<string, unknown>;
  touched: string;
  contains: string;
}> = [
  {
    tool: "hexagen_create_context",
    args: { name: "billing", type: "core" },
    touched: "createContext:billing:core",
    contains: "created billing",
  },
  {
    tool: "hexagen_remove_context",
    args: { context_name: "billing" },
    touched: "removeContext:billing",
    contains: "removed billing",
  },
  {
    tool: "hexagen_create_port",
    args: {
      domain_name: "billing",
      port_name: "PaymentPort",
      type: "outbound",
    },
    touched: "createPort:PaymentPort:outbound",
    contains: "created PaymentPort",
  },
  {
    tool: "hexagen_remove_port",
    args: {
      context_name: "billing",
      port_name: "PaymentPort",
      direction: "outbound",
    },
    touched: "removePort:PaymentPort:outbound",
    contains: "removed PaymentPort",
  },
  {
    tool: "hexagen_create_adapter",
    args: { port_name: "PaymentPort", infrastructure_name: "billing" },
    touched: "createAdapter:PaymentPort",
    contains: "created adapter for PaymentPort",
  },
  {
    tool: "hexagen_add_dependency",
    args: { source_module: "billing", target_module: "shared" },
    touched: "addDependency:billing->shared",
    contains: "dependency updated",
  },
  {
    tool: "hexagen_diff_manifest",
    args: {},
    touched: "diffManifest:git_head",
    contains: "no changes",
  },
];

describe("manifest-structure tools driven by inbound-port fakes", () => {
  it("registers all seven manifest-structure tools", () => {
    // Anti-vacuity: the table below proves nothing if the registry stopped
    // carrying these names.
    const missing = CASES.filter(({ tool }) => !toolRegistry.has(tool)).map(
      ({ tool }) => tool,
    );

    expect(missing).toEqual([]);
    expect(CASES).toHaveLength(7);
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
});
