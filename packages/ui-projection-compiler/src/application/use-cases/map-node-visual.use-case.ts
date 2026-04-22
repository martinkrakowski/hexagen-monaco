import type { NodeVisualSpec } from "@hexagen/core-domain";
import type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "../ports/in/map-node-visual.port.js";

export class MapNodeVisualUseCase {
  constructor(private readonly mapper: MapNodeVisualPort) {}

  execute(
    spec: NodeVisualSpec,
    kind: string,
    category?: string,
  ): NodeVisualProjection {
    return this.mapper.map(spec, kind, category);
  }
}
