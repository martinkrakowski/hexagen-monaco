// @hexagen-server-only
//
// Server-only barrel for the Adobe Firefly foundation. Service addons import the
// shared singletons (`fireflyClient`, `jobPort`, `imsTokenProvider`,
// `getStoragePresigner`) and the error classifier from here.
//
// This barrel static-imports ONLY always-emitted modules. The webhook receiver
// (`jobs/webhook-verifier.ts`) is gated on job_mode=webhook and is therefore NOT
// re-exported here — import it directly from your webhook route when enabled.

export { imsTokenProvider } from "./auth/ims-token-provider.adapter";
export { fireflyClient, FireflyClient } from "./http/firefly-client";
export type { FireflyRequestOptions } from "./http/firefly-client";
export { jobPort, FireflyJobAdapter } from "./jobs/job-port";
export { pollJobStatus, fetchStatus } from "./jobs/job-poller";
export { parseJobResult, toJobHandle } from "./jobs/job-result";
export {
  PassthroughStorageAdapter,
  getStoragePresigner,
  setStoragePresigner,
} from "./storage/passthrough-storage.adapter";
export {
  FireflyError,
  FireflyAuthError,
  FireflyEntitlementError,
  FireflyRateLimitError,
  FireflyValidationError,
  FireflyServiceError,
  classifyAdobeError,
} from "./errors/firefly-errors";
export type { AdobeErrorLike } from "./errors/firefly-errors";

export type {
  FireflyAuthPort,
} from "../../domain/ports/out/firefly-auth.port";
export type {
  FireflyJobPort,
  JobHandle,
  JobResult,
  JobOutput,
  JobStatus,
} from "../../domain/ports/out/firefly-job.port";
export type {
  FireflyStoragePort,
  PresignedHref,
} from "../../domain/ports/out/firefly-storage.port";
