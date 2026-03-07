export interface IProjectCurrentBufferStatePort {
  /**
   * Retrieves the current state of the Monaco buffer (content, cursor, selections, etc.).
   * Infrastructure adapters (Monaco Editor instance, text-model wrapper, snapshot service)
   * implement this contract.
   */
  getCurrentState(data: unknown): Promise<unknown>;
}
