import { useEffect, useState } from "react";

/** One kind's daily usage, mirroring the `/api/free-tier/quota` payload. Defined
 * here (not imported from `lib/quota-store`, which pulls in better-sqlite3) so it
 * stays out of the client bundle. */
export interface QuotaInfo {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** Epoch ms of the next reset (UTC midnight). */
  resetAt: number;
}

export interface FreeTierQuota {
  generation: QuotaInfo;
  chat: QuotaInfo;
}

/**
 * Fetch the caller's remaining free-tier quota once, when the hook mounts (the
 * modal is mounted on demand, so that's on open). Returns null until it loads,
 * and stays null on any error — the modal renders fine without the meter.
 */
export function useFreeTierQuota(): FreeTierQuota | null {
  const [quota, setQuota] = useState<FreeTierQuota | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/free-tier/quota", { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<FreeTierQuota>) : null))
      .then((data) => {
        if (!cancelled && data) setQuota(data);
      })
      .catch(() => {
        /* non-fatal — the modal works without the usage line */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return quota;
}
