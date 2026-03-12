import JSZip from "jszip";
import type { Result } from "@hexagen/shared";
import type {
  ZipCreatorPort,
  ZipCreatorError,
} from "../../application/ports/out/zip-creator.port.js";
import type { Project } from "../../domain/entities/project.js";

export class JsZipCreatorAdapter implements ZipCreatorPort {
  async createZip(project: Project): Promise<Result<Buffer, ZipCreatorError>> {
    try {
      const zip = new JSZip();

      for (const [filePath, content] of project.files) {
        zip.file(filePath, content);
      }

      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      return { success: true, value: buffer };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "ZIP_CREATION_FAILED",
          message:
            err instanceof Error ? err.message : "Failed to create zip file",
          cause: err,
        },
      };
    }
  }
}
