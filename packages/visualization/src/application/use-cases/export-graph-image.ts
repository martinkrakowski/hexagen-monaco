import type { Result } from "../result.js";
import type {
  ExportGraphImagePort,
  ExportGraphImageInput,
  ExportGraphImageOutput,
  ImageFormat,
} from "../ports/in/export-graph-image.port.js";
import type {
  GraphImageRendererPort,
  GraphImageRenderRequest,
  RenderedImageEncoding,
} from "../ports/out/graph-image-renderer.port.js";

/** Painted behind the graph when the caller expresses no preference. */
const DEFAULT_BACKGROUND_COLOR = "#ffffff";

/** Raster exports are produced at 2x so they stay legible when zoomed. */
const RASTER_SCALE = 2;

function encodingFor(format: ImageFormat): RenderedImageEncoding {
  switch (format) {
    case "svg":
      return "svg";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "png":
    default:
      return "png";
  }
}

export class ExportGraphImageUseCase implements ExportGraphImagePort {
  constructor(private readonly renderer: GraphImageRendererPort) {}

  async exportImage(
    input: ExportGraphImageInput,
  ): Promise<Result<ExportGraphImageOutput, Error>> {
    try {
      const encoding = encodingFor(input.format);
      const request: GraphImageRenderRequest = {
        target: input.viewportSelector,
        encoding,
        backgroundColor: input.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
        ...(encoding === "svg" ? {} : { scale: RASTER_SCALE }),
      };

      const rendered = await this.renderer.render(request);
      if (rendered === null) {
        return {
          success: false,
          error: new Error(
            `Viewport element not found: ${input.viewportSelector}`,
          ),
        };
      }

      return {
        success: true,
        data: {
          data: rendered.bytes,
          mimeType: rendered.mimeType,
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
