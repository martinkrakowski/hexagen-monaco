/**
 * Encodings a renderer is required to produce.
 *
 * Deliberately narrower than the inbound `ImageFormat`: alias handling (`jpg`
 * vs `jpeg`) and the fallback for an unrecognised format are export *policy*
 * and stay in `ExportGraphImageUseCase`. A renderer only ever sees a
 * normalized encoding.
 */
export type RenderedImageEncoding = "png" | "jpeg" | "svg";

export interface GraphImageRenderRequest {
  /**
   * Opaque handle for the graph viewport region to capture, interpreted by the
   * host: a CSS selector for a DOM adapter, a canvas or region id for a
   * headless one. Never a DOM node — the application layer holds no elements.
   */
  readonly target: string;
  readonly encoding: RenderedImageEncoding;
  /** CSS colour painted behind the graph. */
  readonly backgroundColor: string;
  /**
   * Pixel density for raster output. Absent for vector encodings, which have
   * no raster grid to scale.
   */
  readonly scale?: number;
}

export interface RenderedGraphImage {
  readonly bytes: Uint8Array;
  /** Mime type of `bytes`, as reported by the host that produced them. */
  readonly mimeType: string;
}

/**
 * Driven port: turns a region of a rendered graph into image bytes.
 *
 * The contract is expressed in bytes and a mime type, not in data URLs, blobs
 * or DOM nodes, so a headless renderer or a plain test double satisfies it as
 * readily as the browser adapter does.
 */
export interface GraphImageRendererPort {
  /**
   * Resolves to `null` when the host has no such target — a missing region is
   * an expected answer, not a failure. How that is reported to callers is the
   * use case's decision.
   */
  render(request: GraphImageRenderRequest): Promise<RenderedGraphImage | null>;
}
