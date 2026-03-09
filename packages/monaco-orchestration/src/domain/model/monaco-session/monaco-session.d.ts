/**
 * Domain entity representing a Monaco editor session.
 * Holds runtime + persistable state for a single editing session.
 * Pure domain — no Monaco or framework references.
 */
export declare class MonacoSession {
    readonly id: string;
    content: string;
    language: string;
    lastModifiedAt: number;
    undoStack: unknown[];
    metadata: Record<string, unknown>;
    activeUri?: string | undefined;
    dirty: boolean;
    constructor(id: string, content?: string, language?: string, lastModifiedAt?: number, undoStack?: unknown[], // Placeholder — later SemanticPatch[]
    metadata?: Record<string, unknown>, activeUri?: string | undefined, dirty?: boolean);
    /**
     * Factory for creating an empty new session.
     */
    static createEmpty(id: string, language?: string): MonacoSession;
    /**
     * Produces a serializable snapshot for persistence.
     * Excludes runtime-only fields.
     */
    toPersistedState(): MonacoSession;
    /**
     * Applies a persisted state back into this entity (partial update).
     */
    applyPersistedState(state: MonacoSession): void;
}
//# sourceMappingURL=monaco-session.d.ts.map