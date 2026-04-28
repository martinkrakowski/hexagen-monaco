import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeatureReport } from "../../domain/index.js";
import type { FeatureId } from "../../domain/value-objects/feature-id.js";
import type { ReportRepositoryPort } from "../../application/ports/out/report-repository.port.js";
import type { Result } from "@hexagen/shared";
import { featureIdValue } from "../../domain/value-objects/feature-id.js";
import { ReportPersistenceError } from "../../domain/index.js";

export class FileSystemReportAdapter implements ReportRepositoryPort {
  async save(report: FeatureReport, projectRoot: string): Promise<Result<void>> {
    try {
      const dir = join(projectRoot, ".reports", featureIdValue(report.id));
      await mkdir(dir, { recursive: true });
      const manifestPath = join(dir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(report, null, 2), "utf-8");
      return { success: true, value: undefined };
    } catch (e) {
      const dir = join(projectRoot, ".reports", featureIdValue(report.id));
      const manifestPath = join(dir, "manifest.json");
      return { success: false, error: new ReportPersistenceError("save", manifestPath, e as Error) };
    }
  }

  async load(featureId: FeatureId, projectRoot: string): Promise<Result<FeatureReport | null>> {
    try {
      const manifestPath = join(projectRoot, ".reports", featureIdValue(featureId), "manifest.json");
      const data = await readFile(manifestPath, "utf-8");
      return { success: true, value: JSON.parse(data) as FeatureReport };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true, value: null };
      }
      const manifestPath = join(projectRoot, ".reports", featureIdValue(featureId), "manifest.json");
      return { success: false, error: new ReportPersistenceError("load", manifestPath, e as Error) };
    }
  }

  async appendPhaseReport(featureId: FeatureId, phase: string, content: string, projectRoot: string): Promise<Result<void>> {
    try {
      const dir = join(projectRoot, ".reports", featureIdValue(featureId), phase);
      await mkdir(dir, { recursive: true });
      const reportPath = join(dir, "report.md");
      await appendFile(reportPath, content, "utf-8");
      return { success: true, value: undefined };
    } catch (e) {
      const dir = join(projectRoot, ".reports", featureIdValue(featureId), phase);
      const reportPath = join(dir, "report.md");
      return { success: false, error: new ReportPersistenceError("appendPhaseReport", reportPath, e as Error) };
    }
  }
}
