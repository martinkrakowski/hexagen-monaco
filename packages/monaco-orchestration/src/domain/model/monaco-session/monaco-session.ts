/**
 * Domain entity representing a Monaco editor session.
 * Holds runtime + persistable state for a single editing session.
 * Pure domain — no Monaco or framework references.
 */
export class MonacoSession {
  constructor(
    public readonly id: string,
    public content: string = '',
    public language: string = 'plaintext',
    public lastModifiedAt: number = Date.now(),
    public undoStack: unknown[] = [], // Placeholder — later SemanticPatch[]
    public metadata: Record<string, unknown> = {},
    // Runtime-only (not persisted)
    public activeUri?: string,
    public dirty: boolean = false
  ) {}

  /**
   * Factory for creating an empty new session.
   */
  static createEmpty(
    id: string,
    language: string = 'plaintext'
  ): MonacoSession {
    return new MonacoSession(id, '', language);
  }

  /**
   * Produces a serializable snapshot for persistence.
   * Excludes runtime-only fields.
   */
  toPersistedState(): MonacoSession {
    return new MonacoSession(
      this.id,
      this.content,
      this.language,
      this.lastModifiedAt,
      this.undoStack,
      this.metadata
      // activeUri & dirty excluded
    );
  }

  /**
   * Applies a persisted state back into this entity (partial update).
   */
  applyPersistedState(state: MonacoSession): void {
    this.content = state.content;
    this.language = state.language;
    this.lastModifiedAt = state.lastModifiedAt;
    this.undoStack = state.undoStack;
    this.metadata = state.metadata;
  }
}
