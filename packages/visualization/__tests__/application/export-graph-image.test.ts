import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { ExportGraphImageUseCase } from "../../src/application/use-cases/index.js";
import type {
  ExportGraphImagePort,
  ImageFormat,
} from "../../src/application/ports/in/index.js";
import type {
  GraphImageRendererPort,
  GraphImageRenderRequest,
  RenderedGraphImage,
} from "../../src/application/ports/out/index.js";

/**
 * Distinctive payload: nothing the use case could synthesise on its own, so an
 * implementation that fabricates or drops the renderer's output fails the
 * identity assertions below.
 */
const RENDERED_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const RENDERED_MIME = "image/x-recorded-by-the-double";

interface Recorder {
  readonly port: GraphImageRendererPort;
  readonly requests: GraphImageRenderRequest[];
}

function recordingRenderer(
  result: RenderedGraphImage | null = {
    bytes: RENDERED_BYTES,
    mimeType: RENDERED_MIME,
  },
): Recorder {
  const requests: GraphImageRenderRequest[] = [];
  return {
    requests,
    port: {
      async render(request) {
        requests.push(request);
        return result;
      },
    },
  };
}

function onlyRequest(recorder: Recorder): GraphImageRenderRequest {
  assert.equal(
    recorder.requests.length,
    1,
    "use case must delegate exactly one render request",
  );
  return recorder.requests[0]!;
}

describe("ExportGraphImageUseCase", () => {
  describe("delegates rendering to the injected port", () => {
    // Deliberately NOT `.react-flow__viewport`: that is the selector the
    // browser callers happen to use, so asserting it would also pass for an
    // implementation that hard-codes the target and ignores its input.
    it("forwards the viewport selector as the render target", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      await useCase.exportImage({
        format: "png",
        viewportSelector: "#graph-viewport-under-test",
      });

      assert.equal(onlyRequest(renderer).target, "#graph-viewport-under-test");
    });

    it("returns the renderer's bytes and mime type verbatim", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      const result = await useCase.exportImage({
        format: "png",
        viewportSelector: ".v",
      });

      assert.equal(result.success, true);
      assert.ok(result.success);
      assert.deepEqual(
        Array.from(result.data.data),
        Array.from(RENDERED_BYTES),
      );
      assert.equal(result.data.mimeType, RENDERED_MIME);
    });
  });

  describe("encoding policy stays in the use case", () => {
    const cases: ReadonlyArray<readonly [ImageFormat, string]> = [
      ["png", "png"],
      ["jpg", "jpeg"],
      ["jpeg", "jpeg"],
      ["svg", "svg"],
    ];

    for (const [format, encoding] of cases) {
      it(`normalizes format "${format}" to encoding "${encoding}"`, async () => {
        const renderer = recordingRenderer();
        const useCase = new ExportGraphImageUseCase(renderer.port);

        await useCase.exportImage({ format, viewportSelector: ".v" });

        assert.equal(onlyRequest(renderer).encoding, encoding);
      });
    }

    it("falls back to png for a format outside the union", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      await useCase.exportImage({
        format: "webp" as ImageFormat,
        viewportSelector: ".v",
      });

      assert.equal(onlyRequest(renderer).encoding, "png");
    });
  });

  describe("background policy stays in the use case", () => {
    it("defaults the background to #ffffff when none is given", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      await useCase.exportImage({ format: "png", viewportSelector: ".v" });

      assert.equal(onlyRequest(renderer).backgroundColor, "#ffffff");
    });

    it("forwards an explicit background verbatim", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      await useCase.exportImage({
        format: "png",
        viewportSelector: ".v",
        backgroundColor: "hsl(210 40% 98%)",
      });

      assert.equal(onlyRequest(renderer).backgroundColor, "hsl(210 40% 98%)");
    });
  });

  describe("raster-density policy stays in the use case", () => {
    for (const format of ["png", "jpg", "jpeg"] as const) {
      it(`requests scale 2 for raster format "${format}"`, async () => {
        const renderer = recordingRenderer();
        const useCase = new ExportGraphImageUseCase(renderer.port);

        await useCase.exportImage({ format, viewportSelector: ".v" });

        assert.equal(onlyRequest(renderer).scale, 2);
      });
    }

    it("omits scale entirely for the vector format", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      await useCase.exportImage({ format: "svg", viewportSelector: ".v" });

      const request = onlyRequest(renderer);
      assert.equal(request.scale, undefined);
      assert.equal(
        Object.prototype.hasOwnProperty.call(request, "scale"),
        false,
        "svg requests must not carry a scale key at all",
      );
    });
  });

  describe("failure policy stays in the use case", () => {
    it("maps a null render (target absent) to the not-found error", async () => {
      const renderer = recordingRenderer(null);
      const useCase = new ExportGraphImageUseCase(renderer.port);

      const result = await useCase.exportImage({
        format: "png",
        viewportSelector: ".nonexistent-selector",
      });

      assert.equal(result.success, false);
      assert.ok(!result.success);
      assert.equal(
        result.error.message,
        "Viewport element not found: .nonexistent-selector",
      );
    });

    it("returns a thrown renderer error unchanged, without rethrowing", async () => {
      const boom = new Error("web font embedding failed");
      const useCase = new ExportGraphImageUseCase({
        async render() {
          throw boom;
        },
      });

      const result = await useCase.exportImage({
        format: "png",
        viewportSelector: ".v",
      });

      assert.equal(result.success, false);
      assert.ok(!result.success);
      assert.equal(result.error, boom);
    });
  });

  /**
   * Attack the guard itself: every double below is "wired up" and returns a
   * well-typed answer, but does nothing useful. Each must produce an observation
   * that the arms above reject — otherwise those arms prove nothing.
   */
  describe("stub-port attack", () => {
    it("a renderer that always returns null cannot satisfy the success arms", async () => {
      const useCase = new ExportGraphImageUseCase({
        async render() {
          return null;
        },
      });

      const result = await useCase.exportImage({
        format: "png",
        viewportSelector: ".v",
      });

      assert.equal(result.success, false);
    });

    it("a renderer that produces nothing cannot satisfy the byte-identity arm", async () => {
      const useCase = new ExportGraphImageUseCase({
        async render() {
          return { bytes: new Uint8Array(), mimeType: "" };
        },
      });

      const result = await useCase.exportImage({
        format: "png",
        viewportSelector: ".v",
      });

      assert.ok(result.success);
      assert.notDeepEqual(
        Array.from(result.data.data),
        Array.from(RENDERED_BYTES),
      );
      assert.notEqual(result.data.mimeType, RENDERED_MIME);
    });

    it("the forwarding arms reject a use case that hard-codes the request", async () => {
      const renderer = recordingRenderer();
      // A stand-in that "works" — it returns a successful, correctly shaped
      // Result — but ignores its input entirely. The arms above must not pass
      // for it.
      const hardCoded: ExportGraphImagePort = {
        async exportImage() {
          await renderer.port.render({
            target: ".react-flow__viewport",
            encoding: "png",
            backgroundColor: "#ffffff",
            scale: 2,
          });
          return {
            success: true,
            data: { data: RENDERED_BYTES, mimeType: RENDERED_MIME },
          };
        },
      };

      const result = await hardCoded.exportImage({
        format: "jpg",
        viewportSelector: ".custom-viewport",
        backgroundColor: "#000000",
      });

      assert.ok(result.success, "the stand-in still returns a success Result");

      const request = onlyRequest(renderer);
      assert.notEqual(request.target, ".custom-viewport");
      assert.notEqual(request.encoding, "jpeg");
      assert.notEqual(request.backgroundColor, "#000000");
    });

    it("a use case that forwarded the raw format would be caught", async () => {
      const renderer = recordingRenderer();
      const useCase = new ExportGraphImageUseCase(renderer.port);

      await useCase.exportImage({ format: "jpg", viewportSelector: ".v" });

      assert.notEqual(
        onlyRequest(renderer).encoding,
        "jpg",
        "the inbound alias must not reach the renderer",
      );
    });
  });

  describe("the application layer performs no I/O of its own", () => {
    it("the use-case source touches no DOM, fetch or rendering library", () => {
      const source = readFileSync(
        fileURLToPath(
          new URL(
            "../../src/application/use-cases/export-graph-image.ts",
            import.meta.url,
          ),
        ),
        "utf8",
      );

      for (const forbidden of [
        "html-to-image",
        "document",
        "querySelector",
        "fetch(",
        "blob(",
        "arrayBuffer",
      ]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `application layer must not reference ${forbidden}`,
        );
      }
    });
  });
});
