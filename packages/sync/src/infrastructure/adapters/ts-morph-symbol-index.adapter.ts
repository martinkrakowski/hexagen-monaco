import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import type {
  SymbolReferenceDto,
  SymbolReferenceIndexPort,
} from "../../application/ports/out/symbol-reference-index.port.js";

/**
 * The ts-morph project settings this analyser parses consumer workspaces with.
 *
 * Exported so the parser contract can be pinned by a test against the *same*
 * object production uses, rather than a copy that silently drifts. See
 * `__tests__/refactoring/modern-typescript-syntax.test.ts` (AUD-012): the
 * engine is published and points at arbitrary user code, so the TypeScript
 * version ts-morph bundles has to be at least as new as the one this repo
 * compiles with — ts-morph 22 bundled TS 5.4.2 and could not parse TS 5.9
 * syntax at all.
 *
 * These live here rather than beside the use case (where they used to sit)
 * because they are parser configuration: naming `skipAddingFilesFromTsConfig`
 * or a numeric `moduleResolution` is already speaking ts-morph, and HEX-013 is
 * about the application layer not speaking it.
 */
export const REFACTORING_IMPACT_COMPILER_OPTIONS = {
  skipAddingFilesFromTsConfig: true,
  compilerOptions: {
    target: 99,
    module: 99,
    moduleResolution: 100,
  },
} as const;

/**
 * `SymbolReferenceIndexPort` backed by ts-morph (HEX-013, item 5.7).
 *
 * This is the only place in `packages/sync` outside `src/refactoring/`'s own
 * rewrite patterns that knows the analyser is built on ts-morph. Everything it
 * hands back across the boundary is a `SymbolReferenceDto` of two strings.
 *
 * The reason ladder below is lifted verbatim (order included) from the
 * `DefaultSymbolReferenceProvider` that used to live inside
 * `src/refactoring/impact-analyzer.ts`. The order is contract, not taste: a
 * file can be several of these at once and the first match is what a consumer
 * of the published engine has always been shown. `__tests__/refactoring/
 * symbol-reference-index.contract.test.ts` pins every branch and the
 * precedence between them.
 */
export class TsMorphSymbolIndexAdapter implements SymbolReferenceIndexPort {
  private readonly project: Project;

  constructor() {
    this.project = new Project({ ...REFACTORING_IMPACT_COMPILER_OPTIONS });
  }

  indexFiles(filePaths: readonly string[]): void {
    for (const filePath of filePaths) {
      this.project.addSourceFileAtPath(filePath);
    }
  }

  findReferences(symbolName: string): readonly SymbolReferenceDto[] {
    return this.project
      .getSourceFiles()
      .filter((file) => file.getFullText().includes(symbolName))
      .map((file) => ({
        // `getFilePath()` returns a StandardizedFilePath: absolute and
        // slash-separated even on Windows. That is exactly the dialect the DTO
        // promises, so it crosses the boundary unmodified.
        filePath: file.getFilePath(),
        reason: describeReference(file, symbolName),
      }));
  }
}

/** The one sentence the impact report shows for a referencing file. */
function describeReference(file: SourceFile, symbolName: string): string {
  for (const iface of file.getInterfaces()) {
    if (iface.getName() === symbolName) {
      return `Declares interface ${symbolName}`;
    }
  }

  for (const cls of file.getClasses()) {
    if (cls.getName() === symbolName) {
      return `Declares class ${symbolName}`;
    }
  }

  for (const typeAlias of file.getTypeAliases()) {
    if (typeAlias.getName() === symbolName) {
      return `Declares type ${symbolName}`;
    }
  }

  for (const importDecl of file.getImportDeclarations()) {
    for (const namedImport of importDecl.getNamedImports()) {
      if (namedImport.getName() === symbolName) {
        return `Imports ${symbolName}`;
      }
    }
  }

  for (const exportDecl of file.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      if (namedExport.getName() === symbolName) {
        return `Exports ${symbolName}`;
      }
    }
  }

  for (const typeRef of file.getDescendantsOfKind(SyntaxKind.TypeReference)) {
    if (typeRef.getText().includes(symbolName)) {
      return `References type ${symbolName}`;
    }
  }

  return `Contains reference to ${symbolName}`;
}
