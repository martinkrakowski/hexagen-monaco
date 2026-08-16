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
 * The host globals this adapter genuinely needs, in the order it reaches them.
 *
 * `document` is the browser-only one: `html-to-image` walks a live DOM, and
 * `document.querySelector` is how the opaque `target` becomes an element.
 * `fetch` is checked for completeness rather than because it is the global that
 * fails in practice — every Node this repo supports ships it, and it decodes
 * `data:` URLs there for real.
 *
 * Written as literal `typeof` tests rather than a loop over `globalThis`, so a
 * bundler's dead-code analysis still sees the idiomatic guard.
 */
function missingHostGlobals(): string[] {
  const missing: string[] = [];
  if (typeof document === "undefined") missing.push("document");
  if (typeof fetch === "undefined") missing.push("fetch");
  return missing;
}

/**
 * Browser-side renderer: resolves the target with `document.querySelector`,
 * rasterizes it with `html-to-image`, and decodes the data URL that library
 * returns into raw bytes plus the mime type the payload declares.
 *
 * `html-to-image` is imported lazily so that merely importing this package
 * outside a browser (the CLI, tests, server rendering) does not pull the
 * library in.
 *
 * Calling `render()` outside a browser is a wiring mistake, and it is reported
 * as one. See {@link missingHostGlobals} for why `null` is the wrong answer
 * there.
 */
export class HtmlToImageGraphRenderer implements GraphImageRendererPort {
  async render(
    request: GraphImageRenderRequest,
  ): Promise<RenderedGraphImage | null> {
    // Checked before the dynamic import: `html-to-image` reaching for the DOM
    // at module scope would otherwise bury the real cause under its stack.
    //
    // Deliberately NOT `return null`. The port reserves `null` for "the host
    // has no such target", which `ExportGraphImageUseCase` renders as
    // "Viewport element not found: <selector>" — an answer that would point an
    // operator at their selector when the actual fault is a browser-only
    // adapter wired into a server. The application layer still gets a typed
    // failure rather than a crash: `exportImage` catches and returns this as
    // `{ success: false, error }`, now carrying a message that names the cause
    // instead of an opaque `ReferenceError: document is not defined`.
    const missing = missingHostGlobals();
    if (missing.length > 0) {
      throw new Error(
        `HtmlToImageGraphRenderer requires a browser environment: ` +
          `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not defined. ` +
          `Provide a headless GraphImageRendererPort implementation for non-browser hosts.`,
      );
    }

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
