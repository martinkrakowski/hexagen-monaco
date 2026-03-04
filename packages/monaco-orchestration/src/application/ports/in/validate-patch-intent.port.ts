// Inbound port for ValidatePatchIntent
export interface IValidatePatchIntentPort {
  execute(data: unknown): Promise<unknown>;
}
