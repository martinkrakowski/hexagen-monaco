export interface IProcessIntentPort {
  /**
   * Processes an incoming intent (user or agent).
   * Infrastructure adapters (AI, rule engine, state machine, etc.) implement this.
   */
  process(data: unknown): Promise<unknown>;
}
