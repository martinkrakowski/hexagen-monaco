import type { Job } from "bullmq";

export interface ExportJobData {
  /** Logical dataset identifier — interpreted by the handler. */
  dataset: string;
  /** Output format: "csv" | "json" | "parquet" etc. */
  format: string;
  /** Optional row limit; useful for paginated exports. */
  limit?: number;
}

export interface ExportJobResult {
  outputUrl: string;
  rowCount: number;
  bytes: number;
}

export const EXPORT_JOB_NAME = "export";


/**
 * Default queue this job runs on. Used by start-workers.ts to register
 * the handler only on the matching queue (when present in BULLMQ_QUEUE_NAMES).
 * Fall-through is "default" — the convention is that every install has a
 * "default" queue.
 */
export const EXPORT_DEFAULT_QUEUE = "default";
/**
 * Stub handler for long-running data exports — typically too slow for
 * request/response (CSV of all orders, etc.). Replace the body with your
 * query + upload pipeline. The result row count is reported separately
 * from bytes so callers can show "X rows, Y MB" without re-fetching.
 */
export async function processExportJob(
  job: Job<ExportJobData>,
): Promise<ExportJobResult> {
  await job.log(`export dataset=${job.data.dataset} format=${job.data.format}`);
  await job.updateProgress(10);

  // TODO: replace stub with real query + upload
  const outputUrl = `https://cdn.example.com/exports/${job.id}.${job.data.format}`;
  await job.updateProgress(100);

  return {
    outputUrl,
    rowCount: 0,
    bytes: 0,
  };
}
