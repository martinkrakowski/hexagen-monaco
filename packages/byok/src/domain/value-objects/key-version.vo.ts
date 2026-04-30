export interface KeyVersion {
  readonly version: number;
  readonly activeKeyVersion: number;
}

export function isKeyVersionStale(kv: KeyVersion): boolean {
  return kv.version < kv.activeKeyVersion;
}
