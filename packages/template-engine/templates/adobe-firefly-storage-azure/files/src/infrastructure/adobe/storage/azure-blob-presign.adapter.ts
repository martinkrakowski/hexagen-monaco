// @hexagen-server-only
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  FireflyStoragePort,
  PresignedHref,
} from "../../../domain/ports/out/firefly-storage.port";

/**
 * Azure Blob Storage presigner for the Firefly storage seam.
 *
 * Firefly reads inputs and writes outputs via presigned URLs (`storage:
 * "external"`). This adapter mints a read SAS for inputs and a create/write SAS
 * for outputs against `ADOBE_AZURE_CONTAINER` in `ADOBE_AZURE_STORAGE_ACCOUNT`.
 *
 * Signing: if `ADOBE_AZURE_STORAGE_KEY` is set, the SAS is signed locally with the
 * account key; otherwise the adapter falls back to a managed identity
 * (`DefaultAzureCredential`) and mints a USER-DELEGATION SAS — nothing is hardcoded.
 *
 * Refs are treated as blob names (an optional ADOBE_AZURE_PREFIX is applied). A ref
 * that is already an http(s) URL is returned unchanged, so callers may mix
 * pre-signed hrefs with blob names.
 */
// Interpolated from the url_expiry_seconds answer. Validate + clamp so a bad or
// overridden value never produces a NaN/out-of-range expiry. We deliberately fall
// back rather than throw at module scope — this file is imported at startup (via
// azure-register), so a throw here would crash the app. SAS lifetimes are bounded
// to 1..604800s (7 days, the user-delegation ceiling); default 900 (15 min).
const URL_EXPIRY_SECONDS = resolveExpiry(Number("{url_expiry_seconds}"));

function resolveExpiry(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 900;
  // Clamp AFTER flooring — a fractional value like 0.5 floors to 0, out of range.
  return Math.max(1, Math.min(Math.floor(value), 604_800));
}

// Back-date SAS/key starts a little to absorb clock skew.
const CLOCK_SKEW_MS = 5 * 60_000;
// In managed-identity mode the user-delegation key is reused for this long beyond a
// SAS window, so a single Firefly request (which presigns 2–3+ refs) makes ONE
// getUserDelegationKey control-plane call instead of one per ref.
const DELEGATION_KEY_CACHE_MS = 5 * 60_000;
// User-delegation keys (and the SAS they sign) max out at 7 days.
const MAX_SAS_WINDOW_MS = 604_800 * 1000;

export class AzureBlobPresignStorageAdapter implements FireflyStoragePort {
  private service: BlobServiceClient | undefined;
  // Cached managed-identity user-delegation key + the epoch ms it is valid until.
  private delegationKey: UserDelegationKey | undefined;
  private delegationKeyExpiresOnMs = 0;

  constructor(service?: BlobServiceClient) {
    // Capture NO env here (same reasoning as the s3/gcs presigners). This adapter is
    // constructed at import time by azure-register.ts (a side-effect import at
    // startup), so the service client is built lazily and account/container/prefix
    // are read at presign time — a .env loaded later is honoured, startup stays
    // crash-free, and config is validated at the point of use.
    this.service = service;
  }

  private getService(): BlobServiceClient {
    if (this.service) return this.service;
    const account = requireEnv("ADOBE_AZURE_STORAGE_ACCOUNT", "storage account");
    const url = `https://${account}.blob.core.windows.net`;
    const key = process.env.ADOBE_AZURE_STORAGE_KEY?.trim();
    // Return a local so the result is statically BlobServiceClient (strict TS won't
    // narrow the optional field across the assignment).
    const created = key
      ? new BlobServiceClient(url, new StorageSharedKeyCredential(account, key))
      : new BlobServiceClient(url, new DefaultAzureCredential());
    this.service = created;
    return created;
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
    const account = requireEnv("ADOBE_AZURE_STORAGE_ACCOUNT", "storage account");
    const container = requireEnv("ADOBE_AZURE_CONTAINER", "blob container");
    const blobName = this.key(ref);
    const blobClient = this.getService()
      .getContainerClient(container)
      .getBlobClient(blobName);

    // Back-date the start a little for clock skew; bound the end by the install TTL.
    const startsOn = new Date(Date.now() - CLOCK_SKEW_MS);
    const expiresOn = new Date(Date.now() + URL_EXPIRY_SECONDS * 1000);
    // read → "r"; write → create + write so Firefly can create the output blob.
    const permissions = BlobSASPermissions.parse(action === "read" ? "r" : "cw");
    const values = { containerName: container, blobName, permissions, startsOn, expiresOn };

    const key = process.env.ADOBE_AZURE_STORAGE_KEY?.trim();
    const sas = key
      ? generateBlobSASQueryParameters(
          values,
          new StorageSharedKeyCredential(account, key),
        )
      : generateBlobSASQueryParameters(
          values,
          // No key → reuse a cached user-delegation key (one control-plane call per
          // ~window, not per presign), minted via the managed identity.
          await this.getDelegationKey(expiresOn.getTime()),
          account,
        );
    return `${blobClient.url}?${sas.toString()}`;
  }

  private async getDelegationKey(
    neededUntilMs: number,
  ): Promise<UserDelegationKey> {
    // Reuse the cached key while it still covers this SAS's expiry — the SAS expiry
    // must fall within the key's validity window.
    if (this.delegationKey && this.delegationKeyExpiresOnMs >= neededUntilMs) {
      return this.delegationKey;
    }
    // Mint a key valid a little beyond the SAS window so the next few presigns reuse
    // it; never exceed the 7-day user-delegation ceiling.
    const startsOn = new Date(Date.now() - CLOCK_SKEW_MS);
    const expiresOnMs = Math.min(
      neededUntilMs + DELEGATION_KEY_CACHE_MS,
      Date.now() + MAX_SAS_WINDOW_MS,
    );
    const key = await this.getService().getUserDelegationKey(
      startsOn,
      new Date(expiresOnMs),
    );
    this.delegationKey = key;
    this.delegationKeyExpiresOnMs = expiresOnMs;
    return key;
  }

  private key(ref: string): string {
    const cleanRef = ref.replace(/^\/+/, "");
    // Reject path traversal so a ref can never escape ADOBE_AZURE_PREFIX.
    if (cleanRef.split("/").some((segment) => segment === "..")) {
      throw new Error(`Invalid Azure blob name ${JSON.stringify(ref)}: path traversal ("..") is not allowed.`);
    }
    // Normalise the prefix at call time to a slash-free segment so a "/firefly"
    // (path-style) prefix can't yield blob names that start with "/".
    const prefix = (process.env.ADOBE_AZURE_PREFIX ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!prefix) return cleanRef;
    return `${prefix}/${cleanRef}`;
  }
}

function requireEnv(name: string, label: string): string {
  // Read at call time so a .env loaded after this module is imported is honoured.
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set — set the ${label} the Firefly Azure presigner uses.`);
  }
  return value;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
