// Port for use case: GenerateProject
export interface IGenerateProjectPort {
  execute(data: unknown): Promise<unknown>;
}
