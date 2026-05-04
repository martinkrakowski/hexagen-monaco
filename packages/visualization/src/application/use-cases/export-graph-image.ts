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
    try {
      const { toPng, toJpeg, toSvg } = await import("html-to-image");

      const viewport = document.querySelector(
        input.viewportSelector,
      ) as HTMLElement | null;
      if (!viewport) {
        return {
          success: false,
          error: new Error(`Viewport element not found: ${input.viewportSelector}`),
        };
      }

      const backgroundColor = input.backgroundColor ?? "#ffffff";

      let dataUrl: string;
      switch (input.format) {
        case "jpg":
        case "jpeg":
          dataUrl = await toJpeg(viewport, {
            backgroundColor,
            pixelRatio: 2,
          });
          break;
        case "svg":
          dataUrl = await toSvg(viewport, {
            backgroundColor,
          });
          break;
        case "png":
        default:
          dataUrl = await toPng(viewport, {
            backgroundColor,
            pixelRatio: 2,
          });
          break;
      }

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      return {
        success: true,
        data: {
          data: uint8Array,
          mimeType: blob.type,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err as Error,
      };
    }
  }
}
