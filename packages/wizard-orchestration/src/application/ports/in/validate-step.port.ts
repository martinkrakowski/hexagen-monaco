// Inbound port for ValidateStep
export interface IValidateStepPort {
  execute(data: unknown): Promise<unknown>;
}
