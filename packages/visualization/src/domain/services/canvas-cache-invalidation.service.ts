export interface CacheInvalidationRule {
  trigger: "hash-mismatch" | "structure-change" | "force";
  description: string;
}

export interface ManifestHashInfo {
  hash: string | null;
  timestamp: number;
}

export function shouldInvalidateCache(
  previousHash: string | null,
  currentHash: string,
  forceInvalidate: boolean,
): boolean {
  if (forceInvalidate) {
    return true;
  }

  if (previousHash === null) {
    return true;
  }

  if (previousHash !== currentHash) {
    return true;
  }

  return false;
}

export function generateManifestHash(manifest: unknown): string {
  const str = JSON.stringify(manifest, Object.keys(manifest as object).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function diffManifestHashes(
  oldHash: string | null,
  newHash: string | null,
): { changed: boolean; reason: string } {
  if (oldHash === null && newHash !== null) {
    return { changed: true, reason: "initial-load" };
  }

  if (oldHash !== null && newHash === null) {
    return { changed: true, reason: "manifest-removed" };
  }

  if (oldHash === null && newHash === null) {
    return { changed: false, reason: "no-manifest" };
  }

  if (oldHash !== newHash) {
    return { changed: true, reason: "manifest-changed" };
  }

  return { changed: false, reason: "unchanged" };
}