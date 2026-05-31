// @hexagen-server-only
import type {
  GenerateOptions,
  ImageEditRequest,
  ImageGenerationPort,
  TextToImageRequest,
} from "../../../domain/ports/out/image-generation.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Firefly Generate adapter — the AWS-of-Adobe↔domain boundary for
 * {@link ImageGenerationPort}.
 *
 * Enabled operations (install): {operations}. All five methods are emitted; call
 * the ones your project uses. Each presigns its IO (passthrough unless a storage
 * addon is installed), submits the async job through the shared `fireflyClient`,
 * awaits completion via `FireflyJobPort` (polling or webhook, transparently), and
 * returns the output href(s). Failures convert to a `Result` at this boundary.
 *
 * NOTE: Firefly Generate paths/payloads version frequently — verify against the
 * current Adobe docs.
 */
const DEFAULT_MODEL = process.env.ADOBE_FIREFLY_DEFAULT_MODEL ?? "firefly_v3";
const DEFAULT_SIZE = process.env.ADOBE_FIREFLY_SIZE ?? "{default_size}";

export class FireflyGenerateAdapter implements ImageGenerationPort {
  async textToImage(req: TextToImageRequest): Promise<Result<string[], FireflyError>> {
    return this.run(async () => {
      const output = await getStoragePresigner().presignOutput(req.outputHref);
      const body = this.applyOptions({ prompt: req.prompt, output: external(output.href) }, req);
      return { path: "/v3/images/generate", body };
    });
  }

  async generativeFill(req: ImageEditRequest): Promise<Result<string[], FireflyError>> {
    return this.edit("/v3/images/fill", req);
  }

  async generativeExpand(req: ImageEditRequest): Promise<Result<string[], FireflyError>> {
    return this.edit("/v3/images/expand", req);
  }

  async imageToImage(req: ImageEditRequest): Promise<Result<string[], FireflyError>> {
    // Conditioned generation: the source image is a reference, not a mask target.
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);
      const body: Record<string, unknown> = {
        image: external(input.href),
        output: external(output.href),
      };
      if (req.prompt) body.prompt = req.prompt;
      return { path: "/v3/images/generate", body: this.applyOptions(body, req) };
    });
  }

  async styleTransfer(req: ImageEditRequest): Promise<Result<string[], FireflyError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);
      const body: Record<string, unknown> = {
        styleReference: external(input.href),
        output: external(output.href),
      };
      if (req.prompt) body.prompt = req.prompt;
      return { path: "/v3/images/generate", body: this.applyOptions(body, req) };
    });
  }

  /** Shared flow for the mask-style edits (fill / expand). */
  private async edit(path: string, req: ImageEditRequest): Promise<Result<string[], FireflyError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);
      const body: Record<string, unknown> = {
        image: external(input.href),
        output: external(output.href),
      };
      if (req.prompt) body.prompt = req.prompt;
      if (req.maskHref) {
        body.mask = external((await storage.presignInput(req.maskHref)).href);
      }
      return { path, body: this.applyOptions(body, req) };
    });
  }

  /** Submit → await → collect output hrefs. Presigning happens inside `build`. */
  private async run(
    build: () => Promise<{ path: string; body: unknown }>,
  ): Promise<Result<string[], FireflyError>> {
    try {
      const { path, body } = await build();
      const handle = toJobHandle(await fireflyClient.post(path, body));
      if (!handle.jobId) {
        return err(new FireflyError("Generate submit response did not include a job id."));
      }
      const done = await jobPort.await(handle);
      if (done.status !== "succeeded") {
        return err(new FireflyError(done.error ?? "Generate job did not succeed."));
      }
      const hrefs = done.outputs
        .map((output) => output.href)
        .filter((href): href is string => Boolean(href));
      if (hrefs.length === 0) {
        return err(new FireflyError("Generate job produced no output."));
      }
      return ok(hrefs);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }

  private applyOptions(
    body: Record<string, unknown>,
    opts: GenerateOptions,
  ): Record<string, unknown> {
    body.model = opts.model ?? DEFAULT_MODEL;
    const size = parseSize(opts.size ?? DEFAULT_SIZE);
    if (size) body.size = size;
    if (opts.numVariations !== undefined) body.numVariations = opts.numVariations;
    if (opts.seed !== undefined) body.seeds = [opts.seed];
    // Policy flags pass through verbatim — never hardcoded.
    if (opts.contentCredentials !== undefined) body.contentCredentials = opts.contentCredentials;
    if (opts.safety !== undefined) body.safety = opts.safety;
    return body;
  }
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

function parseSize(size: string): { width: number; height: number } | undefined {
  const match = /^(\d+)x(\d+)$/.exec(size.trim());
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
}

/** Shared singleton. */
export const fireflyGenerate = new FireflyGenerateAdapter();
