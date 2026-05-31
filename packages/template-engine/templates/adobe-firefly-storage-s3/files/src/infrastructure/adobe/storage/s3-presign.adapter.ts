// @hexagen-server-only
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  FireflyStoragePort,
  PresignedHref,
} from "../../../domain/ports/out/firefly-storage.port";

/**
 * Amazon S3 presigner for the Firefly storage seam.
 *
 * Firefly reads inputs and writes outputs via presigned URLs (`storage:
 * "external"`). This adapter presigns a GET for inputs and a PUT for outputs
 * against `ADOBE_S3_BUCKET`. Region + credentials resolve from the AWS chain —
 * the region is never hardcoded (ADOBE_S3_REGION → AWS_REGION → SDK default).
 *
 * Refs are treated as S3 object keys (an optional ADOBE_S3_PREFIX is applied).
 * A ref that is already an http(s) URL is returned unchanged, so callers may mix
 * pre-presigned hrefs with keys.
 */
// Interpolated from the url_expiry_seconds answer. Validate + clamp so a bad or
// overridden value never reaches getSignedUrl as NaN/out-of-range. We deliberately
// fall back rather than throw at module scope — this file is imported at startup
// (via s3-register), so a throw here would crash the app. AWS SigV4 presigned URLs
// allow 1..604800s (7 days); default to 900 (15 min) on an invalid value.
const URL_EXPIRY_SECONDS = resolveExpiry(Number("{url_expiry_seconds}"));

function resolveExpiry(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 900;
  // Clamp AFTER flooring — a fractional value like 0.5 floors to 0, which is
  // outside the 1..604800 range AWS accepts.
  return Math.max(1, Math.min(Math.floor(value), 604_800));
}

export class S3PresignStorageAdapter implements FireflyStoragePort {
  private client: S3Client | undefined;

  constructor(client?: S3Client) {
    // Capture NO env here. This adapter is constructed at import time by
    // s3-register.ts (a side-effect import at startup), so snapshotting env in the
    // constructor would lock in whatever was set before .env loaded. The client is
    // built lazily (region read on first use) and bucket/prefix are read at presign
    // time, so a .env loaded later is honoured — and startup stays crash-free.
    this.client = client;
  }

  private getClient(): S3Client {
    if (this.client) return this.client;
    // Region resolves from the AWS chain at first use; never hardcoded/required
    // (ADOBE_S3_REGION → AWS_REGION → SDK default). Return the local so the result
    // is statically S3Client (strict TS won't narrow the `S3Client | undefined`
    // field across the assignment).
    const region = process.env.ADOBE_S3_REGION ?? process.env.AWS_REGION;
    const created = new S3Client(region ? { region } : {});
    this.client = created;
    return created;
  }

  async presignInput(ref: string): Promise<PresignedHref> {
    if (isHttpUrl(ref)) return { href: ref };
    const href = await getSignedUrl(
      this.getClient(),
      new GetObjectCommand({ Bucket: this.requireBucket(), Key: this.key(ref) }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );
    return { href };
  }

  async presignOutput(ref: string): Promise<PresignedHref> {
    if (isHttpUrl(ref)) return { href: ref };
    const href = await getSignedUrl(
      this.getClient(),
      new PutObjectCommand({ Bucket: this.requireBucket(), Key: this.key(ref) }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );
    return { href };
  }

  private requireBucket(): string {
    // Read at call time so a .env loaded after this module is imported is honoured.
    // Fail loud + fast at the point of use (a config error), not at import.
    const bucket = process.env.ADOBE_S3_BUCKET?.trim();
    if (!bucket) {
      throw new Error("ADOBE_S3_BUCKET is not set — set the bucket the Firefly S3 presigner uses.");
    }
    return bucket;
  }

  private key(ref: string): string {
    const cleanRef = ref.replace(/^\/+/, "");
    // Reject path traversal so a ref can never escape ADOBE_S3_PREFIX.
    if (cleanRef.split("/").some((segment) => segment === "..")) {
      throw new Error(`Invalid S3 object key ${JSON.stringify(ref)}: path traversal ("..") is not allowed.`);
    }
    // Normalise the prefix at call time to a slash-free segment so a "/firefly"
    // (path-style) prefix can't yield object keys that start with "/".
    const prefix = (process.env.ADOBE_S3_PREFIX ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!prefix) return cleanRef;
    return `${prefix}/${cleanRef}`;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
