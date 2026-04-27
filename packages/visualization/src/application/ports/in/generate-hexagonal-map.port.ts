import type { WizardData } from "@hexagen/project-configuration";
import type {
  HexagonEdge,
  HexagonNodeWithLayout,
} from "../../../domain/index.js";

export interface GenerateHexagonalMapInput {
  wizardData: WizardData;
}

export interface GenerateHexagonalMapOutput {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
}

export interface GenerateHexagonalMapPort {
  execute(input: GenerateHexagonalMapInput): GenerateHexagonalMapOutput;
}
