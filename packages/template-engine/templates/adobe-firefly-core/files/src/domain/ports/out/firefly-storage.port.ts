/**
 * Outbound port for presigned-URL storage.
 *
 * Firefly Services pass inputs/outputs as presigned URLs (`storage: "external"`),
 * never multipart. The default `passthrough` implementation assumes the caller
 * already holds presigned hrefs and returns them unchanged; an opt-in
 * `adobe-firefly-storage-*` addon registers a real presigner (S3/GCS/Azure) via
 * the storage seam without coupling the core to any cloud SDK.
 */
export interface PresignedHref {
  /** URL the Firefly service reads from (GET) or writes to (PUT). */
  readonly href: string;
}

export interface FireflyStoragePort {
  /** Presign an input object for Firefly to read. */
  presignInput(ref: string): Promise<PresignedHref>;
  /** Presign an output destination for Firefly to write. */
  presignOutput(ref: string): Promise<PresignedHref>;
}
