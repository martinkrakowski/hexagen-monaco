import type { Job } from "bullmq";

export interface ImageProcessingJobData {
  sourceUrl: string;
  targetWidth: number;
  targetHeight: number;
  format: "jpeg" | "png" | "webp";
}

export interface ImageProcessingJobResult {
  outputUrl: string;
  bytes: number;
  durationMs: number;
}

export const IMAGE_PROCESSING_JOB_NAME = "image-processing";


/**
 * Default queue this job runs on. Used by start-workers.ts to register
 * the handler only on the matching queue (when present in BULLMQ_QUEUE_NAMES).
 * Fall-through is "default" — the convention is that every install has a
 * "default" queue.
 */
export const IMAGE_PROCESSING_DEFAULT_QUEUE = "images";
/**
 * Stub handler — replace the body with a real image pipeline (sharp, Cloudinary,
 * etc.). Kept pure so it can be unit-tested without a Redis connection.
 */
export async function processImageProcessingJob(
  job: Job<ImageProcessingJobData>,
): Promise<ImageProcessingJobResult> {
  const start = Date.now();
  await job.log(
    `image-processing source=${job.data.sourceUrl} target=${job.data.targetWidth}x${job.data.targetHeight}`,
  );
  await job.updateProgress(10);

  // TODO: replace stub with real processing
  const outputUrl = `https://cdn.example.com/${job.id}.${job.data.format}`;
  await job.updateProgress(100);

  return {
    outputUrl,
    bytes: 0,
    durationMs: Date.now() - start,
  };
}
