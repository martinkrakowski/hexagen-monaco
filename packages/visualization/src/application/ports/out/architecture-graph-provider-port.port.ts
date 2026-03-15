import type { HexagonNode, HexagonEdge } from "../../../domain/index.js";
import type { Result } from "../../result.js";

export interface ArchitectureGraphData {
  nodes: HexagonNode[];
  edges: HexagonEdge[];
}

export interface IArchitectureGraphProviderPort {
  getArchitectureGraph(
    projectId: string,
  ): Promise<Result<ArchitectureGraphData, Error>>;
}
