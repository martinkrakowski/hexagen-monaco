// port-analyzer.ts – TypeScript AST analysis for port method signature extraction
// Part of Phase 1: Agent-Friendly Scaffolding
//
// This module uses ts-morph to:
// 1. Parse port interface files
// 2. Extract method signatures with full type information
// 3. Extract import statements for type dependencies
// 4. Generate implementation scaffolds with proper signatures

import {
  Project,
  InterfaceDeclaration,
  MethodSignature,
  ImportDeclaration,
} from "ts-morph";

/**
 * Represents a method signature extracted from a port interface
 */
export interface PortMethodSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    isOptional: boolean;
  }>;
  returnType: string;
  isAsync: boolean;
  documentation?: string;
}

/**
 * Represents an import statement needed for types
 */
export interface TypeImport {
  moduleSpecifier: string;
  namedImports: string[];
  isTypeOnly: boolean;
}

/**
 * Result of analyzing a port file
 */
export interface PortAnalysisResult {
  interfaceName: string;
  methods: PortMethodSignature[];
  imports: TypeImport[];
  filePath: string;
}

/**
 * Analyze a port interface file and extract method signatures and imports
 *
 * @param portFilePath - Absolute path to the port interface file
 * @returns Analysis result with methods and imports, or null if file doesn't exist
 */
export function analyzePortFile(
  portFilePath: string,
): PortAnalysisResult | null {
  try {
    // Create a ts-morph project for analysis
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        target: 99, // ESNext
        module: 99, // ESNext
      },
    });

    // Add the port file to the project
    const sourceFile = project.addSourceFileAtPath(portFilePath);

    // Find the first exported interface (port interfaces are always exported)
    const interfaces = sourceFile.getInterfaces().filter((i) => i.isExported());

    if (interfaces.length === 0) {
      return null;
    }

    const portInterface = interfaces[0];
    const interfaceName = portInterface.getName();

    // Extract method signatures
    const methods = extractMethodSignatures(portInterface);

    // Extract import statements
    const imports = extractImports(sourceFile.getImportDeclarations());

    return {
      interfaceName,
      methods,
      imports,
      filePath: portFilePath,
    };
  } catch {
    // File doesn't exist or can't be parsed
    return null;
  }
}

/**
 * Extract method signatures from an interface declaration
 */
function extractMethodSignatures(
  interfaceDecl: InterfaceDeclaration,
): PortMethodSignature[] {
  const methods: PortMethodSignature[] = [];

  for (const member of interfaceDecl.getMembers()) {
    if (member instanceof MethodSignature) {
      const method = member as MethodSignature;

      // Extract parameters
      const parameters = method.getParameters().map((param) => ({
        name: param.getName(),
        type: param.getType().getText(),
        isOptional: param.isOptional(),
      }));

      // Extract return type
      const returnType = method.getReturnType().getText();

      // Check if method is async (returns Promise)
      const isAsync = returnType.startsWith("Promise<");

      // Extract JSDoc documentation if present
      const jsDocs = method.getJsDocs();
      const documentation =
        jsDocs.length > 0 ? jsDocs[0].getDescription().trim() : undefined;

      methods.push({
        name: method.getName(),
        parameters,
        returnType,
        isAsync,
        documentation,
      });
    }
  }

  return methods;
}

/**
 * Extract import statements from a source file
 */
function extractImports(importDecls: ImportDeclaration[]): TypeImport[] {
  const imports: TypeImport[] = [];

  for (const importDecl of importDecls) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const isTypeOnly = importDecl.isTypeOnly();

    // Extract named imports
    const namedImports: string[] = [];
    const namedImportNodes = importDecl.getNamedImports();

    for (const namedImport of namedImportNodes) {
      namedImports.push(namedImport.getName());
    }

    if (namedImports.length > 0) {
      imports.push({
        moduleSpecifier,
        namedImports,
        isTypeOnly,
      });
    }
  }

  return imports;
}

/**
 * Generate an adapter implementation scaffold from port analysis
 *
 * @param analysis - Port analysis result
 * @param adapterName - Name of the adapter class
 * @returns TypeScript code for the adapter implementation
 */
export function generateAdapterFromPort(
  analysis: PortAnalysisResult,
  adapterName: string,
): string {
  const { interfaceName, methods, imports } = analysis;

  // Generate import statements
  const importStatements = imports
    .map((imp) => {
      const typeOnly = imp.isTypeOnly ? "type " : "";
      const names = imp.namedImports.join(", ");
      return `import ${typeOnly}{ ${names} } from '${imp.moduleSpecifier}';`;
    })
    .join("\n");

  // Generate method implementations
  const methodImpls = methods
    .map((method) => {
      const params = method.parameters
        .map((p) => `${p.name}${p.isOptional ? "?" : ""}: ${p.type}`)
        .join(", ");

      const asyncKeyword = method.isAsync ? "async " : "";
      const doc = method.documentation
        ? `  /**\n   * ${method.documentation}\n   */\n`
        : "";

      return `${doc}  ${asyncKeyword}${method.name}(${params}): ${method.returnType} {
    // TODO: Implement ${method.name}
    throw new Error('Not implemented: ${method.name}');
  }`;
    })
    .join("\n\n");

  return `// @generated adapter stub — edit freely
/**
 * ${adapterName} implements ${interfaceName}
 *
 * This adapter was generated from the port interface.
 * Replace TODO implementations with actual logic.
 */

${importStatements}

export class ${adapterName} implements ${interfaceName} {
${methodImpls}
}
`;
}

/**
 * Generate a use case implementation scaffold from port analysis
 *
 * @param analysis - Port analysis result
 * @param useCaseName - Name of the use case class
 * @param outPorts - Array of out-port names this use case depends on
 * @returns TypeScript code for the use case implementation
 */
export function generateUseCaseFromPort(
  analysis: PortAnalysisResult,
  useCaseName: string,
  outPorts: string[],
): string {
  const { interfaceName, methods, imports } = analysis;

  // Generate import statements
  const importStatements = imports
    .map((imp) => {
      const typeOnly = imp.isTypeOnly ? "type " : "";
      const names = imp.namedImports.join(", ");
      return `import ${typeOnly}{ ${names} } from '${imp.moduleSpecifier}';`;
    })
    .join("\n");

  // Generate constructor parameters for out-ports
  const constructorParams = outPorts
    .map(
      (port) =>
        `private readonly ${port.charAt(0).toLowerCase() + port.slice(1)}: ${port}`,
    )
    .join(",\n    ");

  // Generate method implementations
  const methodImpls = methods
    .map((method) => {
      const params = method.parameters
        .map((p) => `${p.name}${p.isOptional ? "?" : ""}: ${p.type}`)
        .join(", ");

      const asyncKeyword = method.isAsync ? "async " : "";
      const doc = method.documentation
        ? `  /**\n   * ${method.documentation}\n   */\n`
        : "";

      return `${doc}  ${asyncKeyword}${method.name}(${params}): ${method.returnType} {
    // TODO: Implement ${method.name}
    throw new Error('Not implemented: ${method.name}');
  }`;
    })
    .join("\n\n");

  const constructorBlock =
    outPorts.length > 0
      ? `  constructor(
    ${constructorParams}
  ) {}`
      : "";

  return `// @generated use-case stub — edit freely
/**
 * ${useCaseName} implements ${interfaceName}
 *
 * This use case was generated from the port interface.
 * Replace TODO implementations with actual business logic.
 */

${importStatements}

export class ${useCaseName} implements ${interfaceName} {
${constructorBlock}

${methodImpls}
}
`;
}

// Made with Bob
