// Inbound port for ProcessIntent
export interface IProcessIntentPort {
  execute(data: unknown): Promise<unknown>;
}
