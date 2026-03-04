// Inbound port for ApplySemanticPatch
export interface IApplySemanticPatchPort {
  execute(data: unknown): Promise<unknown>;
}
