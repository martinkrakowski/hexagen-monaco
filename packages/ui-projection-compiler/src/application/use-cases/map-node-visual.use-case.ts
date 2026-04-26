import type { NodeVisualSpec } from "@hexagen/core-domain";
import type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "../ports/in/map-node-visual.port.js";

export class MapNodeVisualUseCase {
  constructor(private readonly mapper: MapNodeVisualPort) {}

  execute(spec: NodeVisualSpec): NodeVisualProjection {
    return this.mapper.map(spec);
  }
}
