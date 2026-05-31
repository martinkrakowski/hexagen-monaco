// @hexagen-server-only
import { Storage } from "@google-cloud/storage";
import type {
  FireflyStoragePort,
  PresignedHref,
} from "../../../domain/ports/out/firefly-storage.port";

/**
 * Google Cloud Storage presigner for the Firefly storage seam.
 *
 * Firefly reads inputs and writes outputs via presigned URLs (`storage:
 * "external"`). This adapter signs a V4 read URL for inputs and a V4 write URL
 * for outputs against `ADOBE_GCS_BUCKET`. Credentials resolve from the Google
 * Application Default Credentials chain (GOOGLE_APPLICATION_CREDENTIALS / the
 * Cloud Run / GCE metadata server) — nothing is hardcoded; V4 signing uses the
 * service-account private key locally, or the IAM SignBlob API when no key file
 * is present.
 *
 * Refs are treated as GCS object names (an optional ADOBE_GCS_PREFIX is applied).
 * A ref that is already an http(s) URL is returned unchanged, so callers may mix
 * pre-presigned hrefs with object names.
 */
// Interpolated from the url_expiry_seconds answer. Validate + clamp so a bad or
// overridden value never reaches getSignedUrl as NaN/out-of-range. We deliberately
// fall back rather than throw at module scope — this file is imported at startup
// (via gcs-register), so a throw here would crash the app. GCS V4 signed URLs allow
// 1..604800s (7 days); default to 900 (15 min) on an invalid value.
const URL_EXPIRY_SECONDS = resolveExpiry(Number("{url_expiry_seconds}"));

function resolveExpiry(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 900;
  // Clamp AFTER flooring — a fractional value like 0.5 floors to 0, which is
  // outside the 1..604800 range GCS accepts.
  return Math.max(1, Math.min(Math.floor(value), 604_800));
}

export class GcsPresignStorageAdapter implements FireflyStoragePort {
  private readonly storage: Storage;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(storage?: Storage) {
    // Credentials + project resolve from the Google ADC chain; never hardcoded.
    this.storage = storage ?? new Storage();
    // Read config but DON'T throw here. This adapter is constructed at import time
    // by gcs-register.ts, so throwing on a missing bucket would crash startup for
    // every app that registers GCS — even in dev/CI or on routes that never touch
    // Firefly. Validation is deferred to presign time (requireBucket).
    this.bucket = process.env.ADOBE_GCS_BUCKET ?? "";
    // Normalise the prefix to a slash-free path segment so a "/firefly" (path-style)
    // prefix can't yield object names that start with "/".
    this.prefix = (process.env.ADOBE_GCS_PREFIX ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
  }

  async presignInput(ref: string): Promise<PresignedHref> {
    if (isHttpUrl(ref)) return { href: ref };
    return { href: await this.sign(ref, "read") };
  }

  async presignOutput(ref: string): Promise<PresignedHref> {
    if (isHttpUrl(ref)) return { href: ref };
    return { href: await this.sign(ref, "write") };
  }

  private async sign(ref: string, action: "read" | "write"): Promise<string> {
    const [url] = await this.storage
      .bucket(this.requireBucket())
      .file(this.key(ref))
      .getSignedUrl({
        version: "v4",
        action,
        // GCS takes an absolute expiry; the SDK enforces the 7-day V4 ceiling.
        expires: Date.now() + URL_EXPIRY_SECONDS * 1000,
      });
    return url;
  }

  private requireBucket(): string {
    // Fail loud + fast at the point of use (a config error), not at import.
    if (!this.bucket) {
      throw new Error("ADOBE_GCS_BUCKET is not set — set the bucket the Firefly GCS presigner uses.");
    }
    return this.bucket;
  }

  private key(ref: string): string {
    const cleanRef = ref.replace(/^\/+/, "");
    // Reject path traversal so a ref can never escape ADOBE_GCS_PREFIX.
    if (cleanRef.split("/").some((segment) => segment === "..")) {
      throw new Error(`Invalid GCS object name ${JSON.stringify(ref)}: path traversal ("..") is not allowed.`);
    }
    if (!this.prefix) return cleanRef;
    return `${this.prefix}/${cleanRef}`;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
