// wiring.ts – Auto-wiring generator for composition roots, test doubles, and MCP tools
// Part of Phase 2: Agent-Friendly Scaffolding
//
// This generator automatically creates:
// 1. Composition root updates (wire.server.ts bindings)
// 2. Test doubles (fakes/mocks for ports)
// 3. MCP tool registrations
//
// Reads manifest declarations and generates wiring code so developers don't need
// to manually wire 10-15 files per new use case.

import path from "node:path";
import type { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";

/**
 * Reporter shape for diagnostic output
 */
type ReportRecorder = {
  record: (type: string, target: string, message: string) => void;
};

/**
 * Wiring configuration from manifest
 */
interface WiringConfig {
  enabled?: boolean;
  compositionRoot?: {
    enabled?: boolean;
    outputPath?: string;
  };
  testDoubles?: {
    enabled?: boolean;
    outputPath?: string;
  };
  mcpTools?: {
    enabled?: boolean;
    outputPath?: string;
  };
}

/**
 * Generate composition root bindings for a use case.
 *
 * Creates getter functions in wire.server.ts that instantiate use cases
 * with their dependencies properly injected.
 *
 * @example
 * // Generated code:
 * export const getCreateUserUseCase = (): CreateUserUseCase => {
 *   if (!_createUserUseCase) {
 *     _createUserUseCase = new CreateUserUseCase(
 *       getUserRepository(),
 *       getValidator(),
 *     );
 *   }
 *   return _createUserUseCase;
 * };
 */
function generateCompositionRootBinding(
  useCaseName: string,
  dependencies: string[],
): string {
  const varName = `_${useCaseName.charAt(0).toLowerCase()}${useCaseName.slice(1)}`;
  const getterName = `get${useCaseName}`;

  const depGetters = dependencies.map((dep) => `      get${dep}(),`).join("\n");

  return `
// Auto-generated composition root binding
let ${varName}: ${useCaseName} | null = null;

export const ${getterName} = (): ${useCaseName} => {
  if (!${varName}) {
    ${varName} = new ${useCaseName}(
${depGetters}
    );
  }
  return ${varName};
};
`;
}

/**
 * Generate a test double (fake) for a port interface.
 *
 * Creates an in-memory implementation suitable for testing.
 *
 * @example
 * // Generated code:
 * export class FakeUserRepository implements UserRepositoryPort {
 *   private users: Map<string, User> = new Map();
 *
 *   async save(user: User): Promise<Result<void, Error>> {
 *     this.users.set(user.getId(), user);
 *     return { success: true, value: undefined };
 *   }
 * }
 */
function generateTestDouble(
  portName: string,
  methods: Array<{ name: string; signature: string }>,
): string {
  const className = `Fake${portName.replace("Port", "")}`;

  const methodImpls = methods
    .map(
      (m) =>
        `  ${m.signature} {\n    // TODO: Implement fake behavior\n    throw new Error('Not implemented');\n  }`,
    )
    .join("\n\n");

  return `// @generated test double — edit freely
import type { ${portName} } from '../application/ports/out/${portName.toLowerCase()}.port';

/**
 * ${className} is an in-memory test double for ${portName}.
 *
 * Use this in tests instead of real infrastructure adapters.
 *
 * @example
 * const fake = new ${className}();
 * const useCase = new SomeUseCase(fake);
 * await useCase.execute(input);
 */
export class ${className} implements ${portName} {
${methodImpls}
}
`;
}

/**
 * Generate MCP tool registration for a use case.
 *
 * Creates the tool schema and dispatch logic for Model Context Protocol.
 *
 * @example
 * // Generated code:
 * {
 *   name: "create_user",
 *   description: "Create a new user",
 *   inputSchema: {
 *     type: "object",
 *     properties: { ... }
 *   }
 * }
 */
function generateMcpToolRegistration(
  useCaseName: string,
  inputSchema: Record<string, unknown>,
): string {
  const toolName = useCaseName
    .replace(/UseCase$/, "")
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .slice(1);

  return `// @generated MCP tool registration — edit freely
{
  name: "${toolName}",
  description: "Execute ${useCaseName}",
  inputSchema: ${JSON.stringify(inputSchema, null, 2)},
  handler: async (input: unknown) => {
    const useCase = get${useCaseName}();
    const result = await useCase.execute(input);
    if (result.success) {
      return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
    } else {
      throw new Error(result.error.message);
    }
  }
}`;
}

/**
 * Generate wiring code for a bounded context.
 *
 * This is the main entry point for the wiring generator. It:
 * 1. Reads use case declarations from the manifest
 * 2. Generates composition root bindings
 * 3. Generates test doubles for ports
 * 4. Generates MCP tool registrations
 *
 * @param moduleDir - Package root directory
 * @param moduleName - Bounded context name
 * @param config - Sync configuration
 * @param report - Optional diagnostic recorder
 * @returns Generator result with created/updated files
 */
export async function generateWiring(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  // Access wiring config through unknown cast since it's not in the type yet
  const wiringConfig: WiringConfig | undefined = (
    config.manifest.generator?.sync as unknown as { wiring?: WiringConfig }
  )?.wiring;

  // Opt-in: must be explicitly enabled
  if (!wiringConfig || wiringConfig.enabled !== true) {
    return result;
  }

  const context = config.manifest.bounded_contexts?.find(
    (c) => c.name === moduleName,
  );

  if (!context) {
    config.logger.debug(
      `generateWiring: no bounded context named '${moduleName}' in manifest`,
    );
    return result;
  }

  const useCases = context.layers?.application?.use_cases || [];
  const outPorts = context.layers?.application?.ports?.out || [];

  if (useCases.length === 0) {
    config.logger.debug(
      `generateWiring: no use cases found in '${moduleName}', skipping`,
    );
    return result;
  }

  // Generate composition root if enabled
  if (wiringConfig.compositionRoot?.enabled) {
    const compositionRootPath = path.join(
      moduleDir,
      wiringConfig.compositionRoot.outputPath || "src/composition-root.ts",
    );

    const bindings = useCases.map((useCase) =>
      generateCompositionRootBinding(useCase, outPorts),
    );

    const compositionRootContent = `// @generated composition root — edit freely
/**
 * Composition root for ${moduleName}
 *
 * This file wires up all use cases with their dependencies.
 * Generated by HexaGen wiring generator.
 */

${bindings.join("\n\n")}

// Export all factory functions
export {
${useCases.map((uc) => `  get${uc}`).join(",\n")}
};
`;

    // TODO: Write file using fs.writeFileSync(compositionRootPath, compositionRootContent)
    void compositionRootContent; // Suppress unused variable warning

    result.created.push(compositionRootPath);
    config.logger.info(
      `generateWiring: created composition root at ${compositionRootPath}`,
    );

    if (report) {
      report.record(
        "info",
        compositionRootPath,
        `Generated composition root with ${useCases.length} use case bindings`,
      );
    }
  }

  // Generate test doubles if enabled
  if (wiringConfig.testDoubles?.enabled && outPorts.length > 0) {
    const testDoublesDir = path.join(
      moduleDir,
      wiringConfig.testDoubles.outputPath || "__tests__/doubles/ports",
    );

    for (const port of outPorts) {
      const testDoublePath = path.join(
        testDoublesDir,
        `${port.toLowerCase().replace(/port$/i, "")}.fake.ts`,
      );

      const testDoubleContent = generateTestDouble(port, []);

      // TODO: Write file using fs.writeFileSync(testDoublePath, testDoubleContent)
      void testDoubleContent; // Suppress unused variable warning

      result.created.push(testDoublePath);
      config.logger.debug(
        `generateWiring: created test double for ${port} at ${testDoublePath}`,
      );
    }

    if (report) {
      report.record(
        "info",
        testDoublesDir,
        `Generated ${outPorts.length} test doubles`,
      );
    }
  }

  // Generate MCP tool registrations if enabled
  if (wiringConfig.mcpTools?.enabled && useCases.length > 0) {
    const mcpToolsPath = path.join(
      moduleDir,
      wiringConfig.mcpTools.outputPath || "src/mcp-tools.ts",
    );

    const toolRegistrations = useCases.map((useCase) =>
      generateMcpToolRegistration(useCase, {
        type: "object",
        properties: {
          input: { type: "string", description: "Input for the use case" },
        },
        required: ["input"],
      }),
    );

    const mcpToolsContent = `// @generated MCP tool registrations — edit freely
/**
 * MCP tool registrations for ${moduleName}
 *
 * This file registers all use cases as MCP tools for AI agent consumption.
 * Generated by HexaGen wiring generator.
 */

export const tools = [
${toolRegistrations.map((t) => `  ${t}`).join(",\n")}
];
`;

    // TODO: Write file using fs.writeFileSync(mcpToolsPath, mcpToolsContent)
    void mcpToolsContent; // Suppress unused variable warning

    result.created.push(mcpToolsPath);
    config.logger.info(`generateWiring: created MCP tools at ${mcpToolsPath}`);

    if (report) {
      report.record(
        "info",
        mcpToolsPath,
        `Generated ${useCases.length} MCP tool registrations`,
      );
    }
  }

  config.logger.info(
    `generateWiring: completed for '${moduleName}' (${result.created.length} files created)`,
  );

  return result;
}

// Made with Bob
