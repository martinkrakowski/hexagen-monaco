import type {
  RenderManifestPort,
  RenderedManifest,
} from "../ports/in/render-manifest.port";
import type { Manifest } from "../../domain/model/manifest-schema/manifest-schema";

export class RenderManifestUseCase implements RenderManifestPort {
  async execute(_input: Manifest): Promise<RenderedManifest> {
    throw new Error("RenderManifestUseCase.execute is not implemented");
  }
}
