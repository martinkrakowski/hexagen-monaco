import type { ByokProvider } from "@hexagen/byok";
import type {
  ByokStore,
  ByokStoreEntry,
} from "../../application/ports/byok-store.port.js";

const STORAGE_PREFIX = "byok:";
const STORAGE_KEY = "byok:keys";

export class LocalStorageByokStoreAdapter implements ByokStore {
  private loadEntries(): Map<string, ByokStoreEntry> {
    if (typeof window === "undefined") {
      return new Map();
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as Record<string, ByokStoreEntry>;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  private saveEntries(entries: Map<string, ByokStoreEntry>): void {
    if (typeof window === "undefined") return;
    try {
      const obj = Object.fromEntries(entries);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // localStorage full or unavailable — silently degrade
    }
  }

  private providerKey(provider: ByokProvider): string {
    return `${STORAGE_PREFIX}${provider}`;
  }

  getEntry(provider: ByokProvider): ByokStoreEntry | null {
    return this.loadEntries().get(this.providerKey(provider)) ?? null;
  }

  setEntry(entry: ByokStoreEntry): void {
    const entries = this.loadEntries();
    entries.set(this.providerKey(entry.provider), entry);
    this.saveEntries(entries);
  }

  removeEntry(provider: ByokProvider): void {
    const entries = this.loadEntries();
    entries.delete(this.providerKey(provider));
    this.saveEntries(entries);
  }

  hasEntry(provider: ByokProvider): boolean {
    return this.loadEntries().has(this.providerKey(provider));
  }

  getAllProviders(): ByokProvider[] {
    const entries = this.loadEntries();
    const providers: ByokProvider[] = [];
    for (const [key, entry] of entries) {
      if (key.startsWith(STORAGE_PREFIX)) {
        providers.push(entry.provider);
      }
    }
    return providers;
  }

  clear(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  }
}
