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

  constructor(storage?: Storage) {
    // Credentials + project resolve from the Google ADC chain; never hardcoded.
    // Bucket/prefix are NOT captured here — they're read from process.env at
    // presign time. This adapter is constructed at import time by gcs-register.ts
    // (a side-effect import at startup), so snapshotting env in the constructor
    // would permanently lock in whatever was set before .env loaded. Reading at
    // call time honours a .env loaded later AND keeps startup crash-free
    // (validation stays deferred to presign time).
    this.storage = storage ?? new Storage();
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
    // Read at call time so a .env loaded after this module is imported is honoured.
    // Fail loud + fast at the point of use (a config error), not at import.
    const bucket = process.env.ADOBE_GCS_BUCKET?.trim();
    if (!bucket) {
      throw new Error("ADOBE_GCS_BUCKET is not set — set the bucket the Firefly GCS presigner uses.");
    }
    return bucket;
  }

  private key(ref: string): string {
    const cleanRef = ref.replace(/^\/+/, "");
    // Reject path traversal so a ref can never escape ADOBE_GCS_PREFIX.
    if (cleanRef.split("/").some((segment) => segment === "..")) {
      throw new Error(`Invalid GCS object name ${JSON.stringify(ref)}: path traversal ("..") is not allowed.`);
    }
    // Normalise the prefix at call time to a slash-free segment so a "/firefly"
    // (path-style) prefix can't yield object names that start with "/".
    const prefix = (process.env.ADOBE_GCS_PREFIX ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!prefix) return cleanRef;
    return `${prefix}/${cleanRef}`;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
