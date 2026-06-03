import crypto from "node:crypto";
import { interpolate } from "@hexagen/shared";
import type {
  FileEmitterPort,
  EmitResult,
} from "../application/ports/file-emitter.port.js";
import type {
  TemplateManifest,
  AnswerMap,
  GeneratedFileRecord,
} from "../domain/index.js";
import {
  isOutputEnabled,
  outputPath,
  isContainedRelativePath,
} from "../domain/index.js";

/**
 * Loads a template source file's raw content by template id + path relative to
 * that template's `files/` dir. Returns null when the file does not exist — a
 * planned-but-unimplemented output, skipped silently (as FileSystemFileEmitter
 * does on ENOENT).
 */
export type TemplateFileLoader = (
  templateId: string,
  relPath: string,
) => Promise<string | null>;

/**
 * A FileEmitterPort that materializes outputs into an in-memory `path → content`
 * map instead of writing to disk — the headless counterpart used by the web
 * code-view / ZIP / GitHub generation path.
 *
 * Request-scoped: create one per generation run and read getFiles() afterwards;
 * do not share an instance across runs. It intentionally accumulates across
 * emit() calls so a template's `requires` co-emit into the same map. Precedence
 * against core-generated files is the caller's concern at merge time — this
 * emitter does not write conflict copies.
 */
export class InMemoryFileEmitter implements FileEmitterPort {
  private readonly files = new Map<string, string>();

  constructor(private readonly loadFile: TemplateFileLoader) {}

  /** A snapshot copy of the files accumulated across every emit() in this run. */
  getFiles(): ReadonlyMap<string, string> {
    return new Map(this.files);
  }

  // The port also passes projectRoot/config; both are irrelevant in-memory, so
  // they are omitted here (a method with fewer params satisfies the interface).
  async emit(
    manifest: TemplateManifest,
    answers: AnswerMap,
  ): Promise<EmitResult> {
    const warnings: string[] = [];
    const generatedFiles: GeneratedFileRecord[] = [];

    for (const out of manifest.outputs) {
      if (!isOutputEnabled(out, answers)) continue;
      const rel = outputPath(out);
      // Manifest paths aren't validated against traversal; the Map key is later
      // written to disk/ZIP/GitHub, so reject an escaping path (as the FS emitter
      // does) rather than emit outside the project root.
      if (!isContainedRelativePath(rel)) {
        throw new Error(
          `Template '${manifest.id}' output path '${rel}' escapes the project root`,
        );
      }
      const raw = await this.loadFile(manifest.id, rel);
      if (raw === null) continue; // planned output without a source file — skip

      // interpolate() renders each answer via String(): booleans → "true"/"false",
      // string[] → comma-joined. Fine for current templates (array answers are used
      // only in `when` gating, never interpolated); authors must not rely on
      // structured emission of an array answer here.
      const { output, warnings: interpWarnings } = interpolate(raw, answers);
      for (const key of interpWarnings) {
        warnings.push(`Unresolved template variable '{${key}}' in ${rel}`);
      }
      this.files.set(rel, output);
      generatedFiles.push({ path: rel, contentHash: sha256(output) });
    }

    return { warnings, generatedFiles };
  }
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}
