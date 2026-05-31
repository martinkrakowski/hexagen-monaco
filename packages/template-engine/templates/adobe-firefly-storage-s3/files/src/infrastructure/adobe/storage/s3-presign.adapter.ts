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
const URL_EXPIRY_SECONDS = Number("{url_expiry_seconds}");

export class S3PresignStorageAdapter implements FireflyStoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(client?: S3Client) {
    const region = process.env.ADOBE_S3_REGION ?? process.env.AWS_REGION;
    this.client = client ?? new S3Client(region ? { region } : {});
    // Read config but DON'T throw here. This adapter is constructed at import time
    // by s3-register.ts, so throwing on a missing bucket would crash startup for
    // every app that registers S3 — even in dev/CI or on routes that never touch
    // Firefly. Validation is deferred to presign time (requireBucket).
    this.bucket = process.env.ADOBE_S3_BUCKET ?? "";
    this.prefix = process.env.ADOBE_S3_PREFIX ?? "";
  }

  async presignInput(ref: string): Promise<PresignedHref> {
    if (isHttpUrl(ref)) return { href: ref };
    const href = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.requireBucket(), Key: this.key(ref) }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );
    return { href };
  }

  async presignOutput(ref: string): Promise<PresignedHref> {
    if (isHttpUrl(ref)) return { href: ref };
    const href = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.requireBucket(), Key: this.key(ref) }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );
    return { href };
  }

  private requireBucket(): string {
    // Fail loud + fast at the point of use (a config error), not at import.
    if (!this.bucket) {
      throw new Error("ADOBE_S3_BUCKET is not set — set the bucket the Firefly S3 presigner uses.");
    }
    return this.bucket;
  }

  private key(ref: string): string {
    const cleanRef = ref.replace(/^\/+/, "");
    // Reject path traversal so a ref can never escape ADOBE_S3_PREFIX.
    if (cleanRef.split("/").some((segment) => segment === "..")) {
      throw new Error(`Invalid S3 object key ${JSON.stringify(ref)}: path traversal ("..") is not allowed.`);
    }
    if (!this.prefix) return cleanRef;
    return `${this.prefix.replace(/\/+$/, "")}/${cleanRef}`;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
