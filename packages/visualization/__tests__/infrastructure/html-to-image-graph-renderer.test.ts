import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { HtmlToImageGraphRenderer } from "../../src/infrastructure/adapters/html-to-image-graph-renderer/index.js";

/**
 * The rasterizer is the one thing here that genuinely needs a browser, so it is
 * replaced by a recorder. Everything else the adapter does — resolving the
 * target, shaping the library options, decoding the returned data URL into
 * bytes + mime type — runs for real, which is exactly the behaviour that moved
 * out of `ExportGraphImageUseCase`.
 */
const htmlToImage = vi.hoisted(() => {
  const calls: Array<{ fn: string; node: unknown; options: unknown }> = [];
  let dataUrl = "data:image/png;base64,AAECAw==";
  const record =
    (fn: string) =>
    async (node: unknown, options: unknown): Promise<string> => {
      calls.push({ fn, node, options });
      return dataUrl;
    };
  return {
    calls,
    setDataUrl: (value: string) => {
      dataUrl = value;
    },
    reset: () => {
      calls.length = 0;
      dataUrl = "data:image/png;base64,AAECAw==";
    },
    toPng: record("toPng"),
    toJpeg: record("toJpeg"),
    toSvg: record("toSvg"),
  };
});

vi.mock("html-to-image", () => ({
  toPng: htmlToImage.toPng,
  toJpeg: htmlToImage.toJpeg,
  toSvg: htmlToImage.toSvg,
}));

const VIEWPORT = { tagName: "DIV", id: "viewport" };

function stubDocument(elements: Record<string, unknown>): void {
  vi.stubGlobal("document", {
    querySelector: (selector: string) => elements[selector] ?? null,
  });
}

describe("HtmlToImageGraphRenderer", () => {
  beforeEach(() => {
    htmlToImage.reset();
    stubDocument({ ".react-flow__viewport": VIEWPORT });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null — not a throw — when the target is absent", async () => {
    const renderer = new HtmlToImageGraphRenderer();

    const result = await renderer.render({
      target: ".nonexistent-selector",
      encoding: "png",
      backgroundColor: "#ffffff",
      scale: 2,
    });

    assert.equal(result, null);
    assert.equal(htmlToImage.calls.length, 0);
  });

  it("rasterizes the resolved element and decodes the data URL to bytes", async () => {
    const renderer = new HtmlToImageGraphRenderer();

    const result = await renderer.render({
      target: ".react-flow__viewport",
      encoding: "png",
      backgroundColor: "#ffffff",
      scale: 2,
    });

    assert.equal(htmlToImage.calls.length, 1);
    assert.equal(htmlToImage.calls[0]!.fn, "toPng");
    assert.equal(htmlToImage.calls[0]!.node, VIEWPORT);
    assert.deepEqual(htmlToImage.calls[0]!.options, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
    });

    assert.ok(result);
    assert.deepEqual(Array.from(result.bytes), [0, 1, 2, 3]);
    assert.equal(result.mimeType, "image/png");
  });

  it("routes the jpeg encoding to toJpeg and keeps the mime type from the payload", async () => {
    htmlToImage.setDataUrl("data:image/jpeg;base64,//8A");
    const renderer = new HtmlToImageGraphRenderer();

    const result = await renderer.render({
      target: ".react-flow__viewport",
      encoding: "jpeg",
      backgroundColor: "#123456",
      scale: 2,
    });

    assert.equal(htmlToImage.calls[0]!.fn, "toJpeg");
    assert.deepEqual(htmlToImage.calls[0]!.options, {
      backgroundColor: "#123456",
      pixelRatio: 2,
    });
    assert.ok(result);
    assert.equal(result.mimeType, "image/jpeg");
    assert.deepEqual(Array.from(result.bytes), [255, 255, 0]);
  });

  it("routes the svg encoding to toSvg and passes no pixelRatio when scale is omitted", async () => {
    htmlToImage.setDataUrl("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    const renderer = new HtmlToImageGraphRenderer();

    const result = await renderer.render({
      target: ".react-flow__viewport",
      encoding: "svg",
      backgroundColor: "#ffffff",
    });

    assert.equal(htmlToImage.calls[0]!.fn, "toSvg");
    assert.deepEqual(htmlToImage.calls[0]!.options, {
      backgroundColor: "#ffffff",
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        htmlToImage.calls[0]!.options as object,
        "pixelRatio",
      ),
      false,
    );
    assert.ok(result);
    // `blob.type` keeps the charset parameter, exactly as the pre-port code
    // reported it.
    assert.equal(result.mimeType, "image/svg+xml;charset=utf-8");
    assert.deepEqual(Array.from(result.bytes), [60, 115, 118, 103, 47, 62]);
  });

  it("resolves the target through document.querySelector", async () => {
    const seen: string[] = [];
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        seen.push(selector);
        return VIEWPORT;
      },
    });
    const renderer = new HtmlToImageGraphRenderer();

    await renderer.render({
      target: "#custom-target",
      encoding: "png",
      backgroundColor: "#ffffff",
      scale: 2,
    });

    assert.deepEqual(seen, ["#custom-target"]);
  });
});
