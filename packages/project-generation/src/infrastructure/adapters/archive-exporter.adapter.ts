import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "../../application/ports/out/project-exporter.port.js";

export class ArchiveExporterAdapter implements ProjectExporterPort {
  async export(
    sourceDirectory: string,
    config: ExportConfig,
  ): Promise<ExportResult> {
    try {
      if (config.destination !== "archive") {
        return {
          success: false,
          destinationUrl: "",
          error: "Invalid destination for archive exporter",
        };
      }

      const zip = new JSZip();

      const readDir = async (dirPath: string, basePath: string) => {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(basePath, fullPath);
          if (entry.isDirectory()) {
            await readDir(fullPath, basePath);
          } else {
            const content = await fs.readFile(fullPath);
            zip.file(relativePath, content);
          }
        }
      };

      await readDir(sourceDirectory, sourceDirectory);

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      const zipPath = path.join(sourceDirectory, "project.zip");
      await fs.writeFile(zipPath, zipBuffer);

      return {
        success: true,
        destinationUrl: zipPath,
      };
    } catch (err) {
      return {
        success: false,
        destinationUrl: "",
        error: err instanceof Error ? err.message : "Failed to create archive",
      };
    }
  }
}
