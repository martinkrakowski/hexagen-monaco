import { z } from "zod";

const ModelVerificationCacheEntrySchema = z.object({
  modelId: z.string(),
  verificationTimestamp: z.number(),
  isVerified: z.boolean(),
  expiresAt: z.number(),
  version: z.number().default(1),
});

type ModelVerificationCacheEntry = z.infer<
  typeof ModelVerificationCacheEntrySchema
>;

export class ModelVerificationCacheAdapter {
  private static CACHE_KEY = "hexagen:model-verification-cache";
  private static CACHE_VERSION = 1;
  private static CACHE_EXPIRATION_DAYS = 30;

  public static setVerificationResult(
    modelId: string,
    isVerified: boolean,
  ): void {
    try {
      if (typeof window === "undefined") return;

      const entry: ModelVerificationCacheEntry = {
        modelId,
        verificationTimestamp: Date.now(),
        isVerified,
        expiresAt:
          Date.now() + this.CACHE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
        version: this.CACHE_VERSION,
      };

      localStorage.setItem(this.CACHE_KEY, JSON.stringify(entry));
    } catch {
      return;
    }
  }

  public static getVerificationResult(modelId: string): boolean | null {
    try {
      if (typeof window === "undefined") return null;

      const cachedEntryJson = localStorage.getItem(this.CACHE_KEY);
      if (!cachedEntryJson) return null;

      const parsedEntry = ModelVerificationCacheEntrySchema.safeParse(
        JSON.parse(cachedEntryJson),
      );

      if (!parsedEntry.success) return null;

      const entry = parsedEntry.data;

      if (
        entry.modelId === modelId &&
        entry.version === this.CACHE_VERSION &&
        entry.expiresAt > Date.now()
      ) {
        return entry.isVerified;
      }

      localStorage.removeItem(this.CACHE_KEY);
      return null;
    } catch {
      return null;
    }
  }

  public static clearCache(): void {
    try {
      if (typeof window === "undefined") return;

      localStorage.removeItem(this.CACHE_KEY);
    } catch {
      return;
    }
  }
}
