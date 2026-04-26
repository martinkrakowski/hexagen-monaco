import type { NodeVisualSpec } from "@hexagen/core-domain";
import type {
  MapNodeVisualPort,
  NodeVisualProjection,
} from "../../src/application/ports/in/map-node-visual.port.js";

export class FakeNodeVisualMapper implements MapNodeVisualPort {
  readonly calls: NodeVisualSpec[] = [];

  constructor(
    private readonly factory: (spec: NodeVisualSpec) => NodeVisualProjection = (
      spec,
    ) => ({
      nodeId: spec.nodeId,
      variant: {
        category: "default",
        headerBg: "",
        bodyBg: "",
        border: "",
        handleColor: "",
        headerText: "",
        hexColor: "#000000",
      },
      label: spec.label,
      category: "default",
    }),
  ) {}

  map(spec: NodeVisualSpec): NodeVisualProjection {
    this.calls.push(spec);
    return this.factory(spec);
  }
}
