import type {
  GraphImageRendererPort,
  GraphImageRenderRequest,
  RenderedGraphImage,
} from "../../../application/ports/out/graph-image-renderer.port.js";

interface RasterizeOptions {
  backgroundColor: string;
  pixelRatio?: number;
}

/**
 * Browser-side renderer: resolves the target with `document.querySelector`,
 * rasterizes it with `html-to-image`, and decodes the data URL that library
 * returns into raw bytes plus the mime type the payload declares.
 *
 * `html-to-image` is imported lazily so that merely importing this package
 * outside a browser (the CLI, tests, server rendering) does not pull the
 * library in.
 */
export class HtmlToImageGraphRenderer implements GraphImageRendererPort {
  async render(
    request: GraphImageRenderRequest,
  ): Promise<RenderedGraphImage | null> {
    const { toPng, toJpeg, toSvg } = await import("html-to-image");

    const element = document.querySelector(
      request.target,
    ) as HTMLElement | null;
    if (!element) {
      return null;
    }

    const options: RasterizeOptions = {
      backgroundColor: request.backgroundColor,
      ...(request.scale === undefined ? {} : { pixelRatio: request.scale }),
    };

    let dataUrl: string;
    switch (request.encoding) {
      case "jpeg":
        dataUrl = await toJpeg(element, options);
        break;
      case "svg":
        dataUrl = await toSvg(element, options);
        break;
      case "png":
      default:
        dataUrl = await toPng(element, options);
        break;
    }

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());

    return { bytes, mimeType: blob.type };
  }
}
