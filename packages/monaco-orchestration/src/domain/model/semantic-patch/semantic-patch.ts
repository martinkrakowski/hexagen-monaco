export class SemanticPatch {
  constructor(
    public patchId: string,
    public targetFilePath: string,
    public unifiedDiff: string,
    public astOperations: unknown[],
    public appliedAt: Date,
    public confidence: number
  ) {}
}
