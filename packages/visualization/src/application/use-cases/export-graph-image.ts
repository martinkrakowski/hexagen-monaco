import type { Result } from "../result.js";
import type {
  ExportGraphImagePort,
  ExportGraphImageInput,
  ExportGraphImageOutput,
} from "../ports/in/export-graph-image.port.js";

export class ExportGraphImageUseCase implements ExportGraphImagePort {
  async exportImage(
    input: ExportGraphImageInput,
  ): Promise<Result<ExportGraphImageOutput, Error>> {
    return {
      success: false,
      error: new Error("Export not yet implemented"),
    };
  }
}
