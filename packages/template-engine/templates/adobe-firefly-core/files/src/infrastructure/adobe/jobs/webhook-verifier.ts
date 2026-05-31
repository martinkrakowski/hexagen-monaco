// @hexagen-server-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { jobPort } from "./job-port";
import { parseJobResult } from "./job-result";

/**
 * Inbound webhook receiver for `job_mode=webhook` (this file is emitted only in
 * webhook mode). Verifies the HMAC signature, parses the job payload, and settles
 * the parked promise via the job port's webhook seam.
 *
 * It imports the always-emitted `job-port`/`job-result` modules; nothing
 * always-emitted imports this gated file (engine constraint: a barrel/factory may
 * only static-import files that are always emitted).
 *
 * Wire it into your framework's route, e.g. a Next.js handler:
 *   const ok = handleFireflyWebhook(rawBody, req.headers.get("x-adobe-signature") ?? "");
 *   return new Response(null, { status: ok ? 200 : 401 });
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.ADOBE_WEBHOOK_SECRET;
  // Fail closed: no secret configured means no request can be trusted.
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookOutcome {
  readonly ok: boolean;
  readonly jobId?: string;
}

/**
 * Verify + dispatch an inbound Adobe job webhook. Returns `{ ok: false }` (→ 401)
 * on a bad/absent signature without touching the job registry.
 */
export function handleFireflyWebhook(rawBody: string, signature: string): WebhookOutcome {
  if (!verifyWebhookSignature(rawBody, signature)) return { ok: false };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false };
  }

  const fallbackId =
    (payload as { jobId?: string; id?: string }).jobId ??
    (payload as { id?: string }).id ??
    "";
  const result = parseJobResult(payload, fallbackId);

  // No job id to correlate (malformed payload) — acknowledge nothing, settle nothing.
  if (!result.jobId) return { ok: false };

  if (result.status === "failed") {
    jobPort.rejectJob(result.jobId, new Error(result.error ?? "Firefly job failed"));
  } else if (result.status === "succeeded") {
    jobPort.resolveJob(result.jobId, result);
  }
  // `running` callbacks (progress pings) are acknowledged but not settled.
  return { ok: true, jobId: result.jobId };
}
