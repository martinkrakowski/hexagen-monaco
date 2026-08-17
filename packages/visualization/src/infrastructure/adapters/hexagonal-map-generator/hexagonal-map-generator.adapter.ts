import type {
  GenerateHexagonalMapPort,
  GenerateHexagonalMapInput,
  GenerateHexagonalMapOutput,
} from "../../../application/ports/in/generate-hexagonal-map.port.js";

import { generateHexagonalContextMap } from "./generate-hexagonal-context-map.js";

export class HexagonalMapGeneratorAdapter implements GenerateHexagonalMapPort {
  execute(input: GenerateHexagonalMapInput): GenerateHexagonalMapOutput {
    return generateHexagonalContextMap(input.map);
  }
}
