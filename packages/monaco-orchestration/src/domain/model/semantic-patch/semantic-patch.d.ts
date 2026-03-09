export declare class SemanticPatch {
    patchId: string;
    targetFilePath: string;
    unifiedDiff: string;
    astOperations: unknown[];
    appliedAt: Date;
    confidence: number;
    constructor(patchId: string, targetFilePath: string, unifiedDiff: string, astOperations: unknown[], appliedAt: Date, confidence: number);
}
//# sourceMappingURL=semantic-patch.d.ts.map