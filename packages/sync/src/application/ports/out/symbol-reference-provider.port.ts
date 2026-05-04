import type { SourceFile } from "ts-morph";

export interface SymbolReferenceResult {
  sourceFile: SourceFile;
  reason: string;
}

export interface SymbolReferenceProviderPort {
  findReferences(symbolName: string, sourceFiles: SourceFile[]): SymbolReferenceResult[];
  getModificationReason(sourceFile: SourceFile, symbolName: string): string;
}