// Inbound port for ProjectCurrentBufferState
export interface IProjectCurrentBufferStatePort {
  execute(data: unknown): Promise<unknown>;
}
