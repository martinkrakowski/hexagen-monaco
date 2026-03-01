// Port for use case: ValidateSpec
export interface IValidateSpecPort {
  execute(data: unknown): Promise<unknown>;
}
