// Port for use case: RenderManifest
export interface IRenderManifestPort {
  execute(data: unknown): Promise<unknown>;
}
