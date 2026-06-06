// port-analyzer.ts – TypeScript AST analysis for port method signature extraction
// Part of Phase 1: Agent-Friendly Scaffolding
//
// This module uses ts-morph to:
// 1. Parse port interface files
// 2. Extract method signatures with full type information
// 3. Extract import statements for type dependencies
// 4. Generate implementation scaffolds with proper signatures

import path from "node:path";
import {
  Project,
  InterfaceDeclaration,
  MethodSignature,
  ImportDeclaration,
} from "ts-morph";

/**
 * Module specifier for importing `toFile` from `fromFile`, as an ESM-style
 * relative path with a `.js` extension (e.g. an adapter in
 * `infrastructure/adapters/` importing its port in `application/ports/out/`
 * yields `../../application/ports/out/x.out-port.js`). Used so a generated
 * adapter/use-case can import the port interface it implements.
 */
export function relativeImportSpecifier(
  fromFile: string,
  toFile: string,
): string {
  let rel = path
    .relative(path.dirname(fromFile), toFile)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, ".js");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

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
  portImportSpecifier?: string,
): string {
  const { interfaceName, methods, imports } = analysis;

  // The adapter `implements ${interfaceName}`, so it must import that interface.
  // The caller passes the port's module specifier as seen from the adapter file
  // (this function doesn't know where the adapter will be written). Without it the
  // generated adapter references an undefined name and fails to typecheck.
  const portImport = portImportSpecifier
    ? `import type { ${interfaceName} } from '${portImportSpecifier}';`
    : "";

  // Generate import statements (port interface first, then the port's own type imports)
  const importStatements = [
    portImport,
    ...imports.map((imp) => {
      const typeOnly = imp.isTypeOnly ? "type " : "";
      const names = imp.namedImports.join(", ");
      return `import ${typeOnly}{ ${names} } from '${imp.moduleSpecifier}';`;
    }),
  ]
    .filter(Boolean)
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
 * A single out-port dependency injected into a use-case's constructor. The
 * caller pre-resolves these from the manifest + naming conventions because the
 * out-port stub files may not exist yet when the use-case is emitted (use_cases
 * are emitted before ports.out) — so they can't be analyzed from disk here.
 */
export interface UseCaseOutPort {
  /** The out-port interface type, e.g. `OrderRepoPort`. */
  interfaceName: string;
  /** The constructor parameter name, e.g. `orderRepo`. */
  paramName: string;
  /** ESM relative specifier to the out-port, e.g. `../ports/out/OrderRepo.out-port.js`. */
  importSpecifier: string;
}

/**
 * Generate a use case implementation scaffold from port analysis
 *
 * @param analysis - Port analysis result (the in-port the use-case fulfils)
 * @param useCaseName - Name of the use case class
 * @param outPorts - Resolved out-port dependencies (interface + import + param name)
 * @param portImportSpecifier - Module specifier for the in-port interface, as seen
 *   from the use-case file (so `implements <interfaceName>` resolves)
 * @returns TypeScript code for the use case implementation
 */
export function generateUseCaseFromPort(
  analysis: PortAnalysisResult,
  useCaseName: string,
  outPorts: UseCaseOutPort[],
  portImportSpecifier?: string,
): string {
  const { interfaceName, methods, imports } = analysis;

  // The use-case `implements ${interfaceName}` (its in-port), so that interface
  // must be imported — the caller passes its specifier (this function doesn't
  // know where the use-case will be written). Each out-port is imported by its
  // RESOLVED interface name, never the raw manifest name (which may be
  // kebab/extensioned — not a valid identifier or type). Without both, the
  // use-case fails to typecheck (#248).
  const importLines = [
    portImportSpecifier
      ? `import type { ${interfaceName} } from '${portImportSpecifier}';`
      : "",
    ...outPorts.map(
      (p) => `import type { ${p.interfaceName} } from '${p.importSpecifier}';`,
    ),
    ...imports.map((imp) => {
      const typeOnly = imp.isTypeOnly ? "type " : "";
      const names = imp.namedImports.join(", ");
      return `import ${typeOnly}{ ${names} } from '${imp.moduleSpecifier}';`;
    }),
  ].filter(Boolean);
  // De-dupe identical import lines (e.g. an out-port interface that also appears
  // among the in-port's own type imports).
  const importStatements = [...new Set(importLines)].join("\n");

  // Generate constructor parameters: inject each out-port by its interface type.
  const constructorParams = outPorts
    .map((p) => `private readonly ${p.paramName}: ${p.interfaceName}`)
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
