/**
 * The refactoring analyser's view of a parsed workspace (HEX-013, item 5.7).
 *
 * WHY A PORT AT ALL. `RefactoringImpactUseCase` previously constructed a
 * ts-morph `Project` itself and passed live `SourceFile` nodes to its
 * collaborator. That made a concrete third-party parser — one that bundles its
 * own TypeScript compiler, so its version is a semantic fact and not a detail
 * (AUD-012) — a compile-time dependency of the application layer, in a package
 * that is *published* and pointed at arbitrary consumer workspaces.
 *
 * WHY THIS SHAPE AND NOT A PARSER FACADE. The port is deliberately NOT a
 * narrowed `SourceFile`. Everything the use case does with a parsed file is:
 *  - decide whether the file mentions the symbol at all, and
 *  - obtain a human-readable sentence saying how (`getModificationReason`),
 *  - read the file's path, to classify layer and package.
 * Nothing else about the AST ever escapes: `classifyFiles` turns each hit into
 * a `FileToModify` of four strings, and every step after that
 * (`detectCrossPackageDependencies`, `assessArchitecturalImpact`,
 * `generateWarnings`, `estimateChanges`) operates on those strings alone. So
 * the port yields exactly those two fields and no node types. A port that
 * mirrored `getInterfaces()` / `getClasses()` / `getImportDeclarations()`
 * would have relocated the dependency without removing it — the caller would
 * still be programming against ts-morph's object model under new names.
 *
 * WHY IT IS STATEFUL. The analyser loads packages and apps in separate
 * recursive passes and then asks one question of the whole set, so the index
 * accumulates across `indexFiles` calls and `findReferences` answers over
 * everything indexed so far. That is the pre-existing semantics preserved
 * exactly; collapsing it into one call would quietly change what a second
 * `analyze()` on the same instance sees.
 *
 * RI-2.1. `diagnostics` is optional and syntactic-only. Semantic errors
 * (unresolved types, missing modules) are not collected — a consumer
 * workspace with those would flood the warning channel. An empty or
 * omitted array means "I could read this file".
 */

/** One file that mentions the symbol under analysis. Plain data, no AST. */
export interface SymbolReferenceDto {
  /**
   * Absolute path to the file, slash-separated on every host.
   *
   * The dialect is part of the contract, not an accident of the
   * implementation: `toWorkspaceRelativePosixPath` subtracts a *native*
   * workspace root from this string, and the old literal-prefix strip was a
   * no-op on Windows because the two dialects never matched (AUD-012).
   */
  readonly filePath: string;

  /**
   * Why this file appears in the impact report — e.g. `Declares interface
   * OrderRepositoryPort`, `Imports OrderRepositoryPort`. Surfaced verbatim to
   * the user as `FileToModify.reason`.
   */
  readonly reason: string;

  /**
   * Syntactic diagnostics from the parser for this file. Absent or empty
   * when the file parsed. Never semantic diagnostics.
   */
  readonly diagnostics?: readonly string[];
}

/** A parsed, queryable index of workspace source files. */
export interface SymbolReferenceIndexPort {
  /**
   * Add source files to the index. Additive: files indexed by earlier calls
   * remain queryable. Implementations may throw if a path cannot be read; the
   * use case turns that into an error `Result`.
   */
  indexFiles(filePaths: readonly string[]): void;

  /**
   * Every indexed file that references `symbolName`, with the reason it does.
   * Files that never mention the symbol are omitted entirely.
   */
  findReferences(symbolName: string): readonly SymbolReferenceDto[];
}
