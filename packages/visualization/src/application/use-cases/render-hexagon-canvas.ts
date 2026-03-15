import { createCanvasViewport } from "../../domain/index.js";
import type {
  RenderHexagonCanvasPort,
  RenderHexagonCanvasInput,
  RenderHexagonCanvasOutput,
} from "../ports/in/index.js";

export class RenderHexagonCanvasUseCase implements RenderHexagonCanvasPort {
  async render(
    input: RenderHexagonCanvasInput,
  ): Promise<RenderHexagonCanvasOutput> {
    return {
      canvasId: input.canvasId,
      viewport: input.viewport ?? createCanvasViewport(),
    };
  }
}
