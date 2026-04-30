import type { ByokProvider } from "@hexagen/byok";

export interface ByokStoreEntry {
  readonly ciphertext: string;
  readonly provider: ByokProvider;
  readonly keyId: string;
  readonly createdAt: string;
}

export interface ByokStore {
  getEntry(provider: ByokProvider): ByokStoreEntry | null;
  setEntry(entry: ByokStoreEntry): void;
  removeEntry(provider: ByokProvider): void;
  hasEntry(provider: ByokProvider): boolean;
  getAllProviders(): ByokProvider[];
  clear(): void;
}
