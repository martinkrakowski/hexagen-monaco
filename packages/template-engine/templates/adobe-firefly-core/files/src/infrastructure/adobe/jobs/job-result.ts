// @hexagen-server-only
import { z } from "zod";
import type {
  JobHandle,
  JobOutput,
  JobResult,
  JobStatus,
} from "../../../domain/ports/out/firefly-job.port";

/**
 * Normalises Adobe's (per-service-variable) job status payloads into the domain
 * `JobResult`. Firefly services disagree on field names — `status` vs `jobStatus`,
 * `outputs` vs `result` — so the schema is intentionally lenient and the mapping
 * is centralised here, keeping the poller and webhook paths in agreement.
 */
const hrefHolder = z
  .object({
    href: z.string().optional(),
    url: z.string().optional(),
    destination: z.object({ href: z.string().optional() }).optional(),
    image: z.object({ href: z.string().optional() }).optional(),
  })
  .passthrough();

const jobPayloadSchema = z
  .object({
    jobId: z.string().optional(),
    id: z.string().optional(),
    status: z.string().optional(),
    jobStatus: z.string().optional(),
    outputs: z.array(hrefHolder).optional(),
    result: z.unknown().optional(),
    errors: z.unknown().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const RUNNING = new Set(["running", "pending", "in_progress", "in-progress", "queued", "submitted", "training"]);
const SUCCEEDED = new Set(["succeeded", "success", "done", "complete", "completed"]);

export function parseJobResult(raw: unknown, fallbackJobId: string): JobResult {
  // Total by design — never throws. An unrecognised payload (e.g. a non-object)
  // resolves to a terminal `failed` so neither the poller nor the webhook path
  // loops or crashes on a malformed body.
  const parsed = jobPayloadSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { jobId: fallbackJobId, status: "failed", outputs: [], error: "Unrecognised job payload" };
  }
  const p = parsed.data;
  const jobId = p.jobId ?? p.id ?? fallbackJobId;
  const status = normaliseStatus(p.status ?? p.jobStatus);

  const outputs: JobOutput[] = (p.outputs ?? []).map((o) => {
    const href = o.href ?? o.url ?? o.destination?.href ?? o.image?.href;
    return href ? { href } : { data: o };
  });
  // Non-asset services (e.g. Content Tagging) return data under `result`.
  if (outputs.length === 0 && p.result !== undefined) {
    outputs.push({ data: p.result });
  }

  return {
    jobId,
    status,
    outputs,
    error: status === "failed" ? describeError(p) : undefined,
  };
}

/**
 * Map an async submit response onto a `JobHandle`. Firefly services return the
 * job id and status URL under varying keys (`jobId`/`id`, `statusUrl`/`self.href`/
 * `_links.self.href`); every service adapter funnels its POST result through this
 * so the job port can poll or correlate a webhook. Total — never throws.
 */
const submitSchema = z
  .object({
    jobId: z.string().optional(),
    id: z.string().optional(),
    statusUrl: z.string().optional(),
    self: z.object({ href: z.string().optional() }).optional(),
    _links: z.object({ self: z.object({ href: z.string().optional() }).optional() }).optional(),
  })
  .passthrough();

export function toJobHandle(raw: unknown): JobHandle {
  const parsed = submitSchema.safeParse(raw ?? {});
  if (!parsed.success) return { jobId: "" };
  const r = parsed.data;
  return {
    jobId: r.jobId ?? r.id ?? "",
    statusUrl: r.statusUrl ?? r.self?.href ?? r._links?.self?.href,
  };
}

function normaliseStatus(value: string | undefined): JobStatus {
  const v = (value ?? "running").toLowerCase();
  if (SUCCEEDED.has(v)) return "succeeded";
  if (RUNNING.has(v)) return "running";
  return "failed";
}

function describeError(p: { errors?: unknown; message?: string }): string {
  if (typeof p.message === "string") return p.message;
  if (p.errors !== undefined) {
    try {
      return JSON.stringify(p.errors).slice(0, 300);
    } catch {
      return "Firefly job failed";
    }
  }
  return "Firefly job failed";
}
