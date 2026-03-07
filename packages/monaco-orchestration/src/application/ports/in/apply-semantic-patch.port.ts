export interface IApplySemanticPatchPort {
  /**
   * Applies a semantic patch to the current buffer/state.
   * Infrastructure adapters (Monaco Editor model, AST transformer,
   * text-model adapter, etc.) implement this contract.
   */
  apply(data: unknown): Promise<unknown>;
}
