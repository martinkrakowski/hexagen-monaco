"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "../../../lib/structured-logger";
import {
  applyScanFrame,
  describePreStreamFailure,
  describeUnavailable,
  finishScanRun,
  initialScanRun,
  isRunSettled,
  parseScanFrame,
  startedScanRun,
  type ScanFrame,
  type ScanRun,
} from "./scan-stream";

/**
 * S2 transport (F-16, BF-5.3). The ONLY module in this packet that performs
 * I/O; every decision it makes about what the user sees is delegated to the
 * pure `scan-stream.ts` beside it.
 *
 * ## Why `useStagedGenerationStream` is NOT reused here
 *
 * BF-1.2 promoted that hook to `app/lib/` specifically to unblock this packet,
 * so not using it needs a reason. There are three, and each is a defect this
 * screen would inherit rather than a stylistic preference:
 *
 * 1. **It reconnects by re-POSTing the same body.** For manifest generation
 *    that is merely wasteful. Here the route charges the caller's daily scan
 *    quota and starts a `git clone` on every POST, so a single dropped packet
 *    would silently spend a second scan and start a second clone — and the
 *    route's own per-IP budget is three requests a minute, so the reconnects
 *    would then 429. A dropped connection must be REPORTED here, never retried
 *    behind the user's back.
 * 2. **It discards the error `code`.** Its terminal-frame writer keeps
 *    `event.message` only. The whole F-35 contract of this route is the closed
 *    code set — dropping it makes the "map code to message in one place" rule
 *    unimplementable.
 * 3. **Its `done` arm reads `event.yaml`, `contextCount`, `portCount` and
 *    `adapterCount`,** none of which exist on a scan's `done` frame, which
 *    carries `result: ProjectScanResponse`.
 *
 * What is shared is the SHAPE — a read loop, a residual-buffer flush through
 * the same writer as the loop, and an inactivity watchdog — because those are
 * the parts of that hook that were hard-won and are worth copying deliberately.
 */

/**
 * Inactivity ceiling. The route declares `maxDuration = 120` (a 60s clone
 * budget plus a 45s scan budget plus headroom), and the scan stage is silent
 * for its whole duration — no `chunk` frames come out of `hexagen scan`. So the
 * watchdog has to sit comfortably ABOVE the server's own ceiling, or it would
 * kill legitimate slow runs. It exists only for the case where the server is
 * already gone and nothing will ever close the socket.
 */
export const STREAM_INACTIVITY_MS = 180_000;

/** How often the watchdog looks at the clock. */
const WATCHDOG_TICK_MS = 5_000;

/**
 * What the deployment says about this endpoint.
 *
 * `not-enabled` is the DEFAULT state of the world, not an edge case:
 * `BROWNFIELD_GITHUB_SCAN` is off unless a deployment sets it, and the route
 * then answers 404 to both GET and POST. Learning that before the user types
 * anything is the difference between an honest screen and a form that throws
 * an error on submit.
 */
export type GithubScanAvailability =
  | "checking"
  | "available"
  | "not-enabled"
  /** The probe itself failed. Not evidence of anything — let the POST speak. */
  | "unknown";

export interface GithubScanRequest {
  readonly projectName: string;
  readonly repoReference: string;
  /** Branch or tag; blank means "use the repository's default branch". */
  readonly ref: string;
}

export interface UseGithubScanReturn {
  readonly availability: GithubScanAvailability;
  readonly run: ScanRun;
  /** Resolves with the SETTLED run, so the caller needs no effect to react. */
  readonly start: (request: GithubScanRequest) => Promise<ScanRun>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

const ENDPOINT = "/api/projects/scan/github";

/** `Retry-After`, defensively: a thrown header read must not replace precise copy. */
function retryAfterOf(response: Response): string | null {
  try {
    return response.headers.get("Retry-After");
  } catch {
    return null;
  }
}

/** First parseable failure frame in a single-frame error body, if any. */
function readFailureFrame(
  body: string,
): Extract<ScanFrame, { kind: "failure" }> | null {
  for (const line of body.split("\n")) {
    const frame = parseScanFrame(line);
    if (frame?.kind === "failure") return frame;
  }
  return null;
}

export function useGithubScan(): UseGithubScanReturn {
  const [availability, setAvailability] =
    useState<GithubScanAvailability>("checking");
  const [run, setRun] = useState<ScanRun>(initialScanRun);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  /**
   * Availability probe. `GET` mirrors `POST`'s kill switch on purpose (see the
   * route's own comment): 404 when the feature is off, 405 with `Allow: POST`
   * when it is on. It is not rate-limited — `guardMutation` runs on POST only —
   * so this costs nothing but one cheap round trip.
   *
   * Anything other than those two answers leaves availability `unknown` rather
   * than guessing. A proxy that rewrites errors must not be able to hide a
   * working feature behind a "not available" screen.
   */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(ENDPOINT, {
          method: "GET",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (response.status === 404) {
          setAvailability("not-enabled");
        } else if (response.status === 405 || response.ok) {
          setAvailability("available");
        } else {
          setAvailability("unknown");
        }
      } catch {
        if (!cancelled) setAvailability("unknown");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Abort an in-flight stream on unmount. The route listens to the request
  // signal and kills the clone's whole process group when it drops, so this is
  // not merely tidy: it stops a subprocess on someone else's machine.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setRun(initialScanRun());
  }, []);

  const start = useCallback(
    async (request: GithubScanRequest): Promise<ScanRun> => {
      // One run at a time. A double-submit would charge two scans and start two
      // clones, which is precisely what the quota gate cannot undo.
      if (inFlightRef.current) return run;
      inFlightRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      // Folded locally and mirrored into state. Reading `run` inside the loop
      // would read the value captured by THIS render and lose every frame
      // after the first.
      let current = startedScanRun();
      setRun(current);

      const push = (next: ScanRun) => {
        current = next;
        setRun(next);
      };

      let watchdog: ReturnType<typeof setInterval> | null = null;
      let lastDataAt = Date.now();
      let starved = false;

      try {
        const trimmedRef = request.ref.trim();
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: request.projectName.trim(),
            repoUrl: request.repoReference,
            // Omitted, not empty-stringed: the route treats an absent ref as
            // "use the default branch" and resolves it from the preflight.
            ...(trimmedRef.length === 0 ? {} : { ref: trimmedRef }),
          }),
          signal: controller.signal,
        });

        if (response.status === 404) {
          // The switch was off all along, or was turned off between the probe
          // and now. Same fact, same copy, and the screen re-renders as the
          // "not available here" state rather than as a failed scan.
          setAvailability("not-enabled");
          push({
            ...current,
            phase: "blocked",
            outcome: null,
            failure: describeUnavailable(),
          });
          return current;
        }

        if (!response.ok || response.body === null) {
          const body = await response.text().catch(() => "");
          push({
            ...current,
            phase: "blocked",
            outcome: null,
            failure: describePreStreamFailure(
              response.status,
              readFailureFrame(body),
              retryAfterOf(response),
            ),
          });
          return current;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        watchdog = setInterval(() => {
          if (Date.now() - lastDataAt > STREAM_INACTIVITY_MS) {
            starved = true;
            // `cancel()` resolves the pending read with `done: true` instead of
            // throwing, so the loop exits through the same path as a clean EOF
            // and the ending below explains which it was.
            void reader.cancel().catch(() => undefined);
          }
        }, WATCHDOG_TICK_MS);

        try {
          readLoop: for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            lastDataAt = Date.now();
            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const frame = parseScanFrame(line);
              if (frame === null) continue;
              push(applyScanFrame(current, frame));
              if (isRunSettled(current)) {
                // Terminal by protocol. Stop reading rather than waiting for
                // the server to close, which would park this promise (and the
                // caller's submit button) on a read that may never resolve.
                void reader.cancel().catch(() => undefined);
                break readLoop;
              }
            }
          }
        } finally {
          if (watchdog !== null) clearInterval(watchdog);
          watchdog = null;
          reader.releaseLock();
        }

        // Residual flush, through the SAME writer as the loop. A terminal frame
        // that arrived without its trailing newline is stranded in `buffer`,
        // and routing it anywhere else is how a reported failure silently
        // becomes a hang.
        if (buffer.trim().length > 0 && !isRunSettled(current)) {
          const frame = parseScanFrame(buffer);
          if (frame !== null) push(applyScanFrame(current, frame));
        }

        // Reader ended with no `done` and no `error`: the connection dropped
        // mid-clone, a proxy closed it, or the watchdog gave up. The run is
        // over and produced nothing; saying so is the only honest option.
        if (!isRunSettled(current)) {
          push(
            finishScanRun(
              current,
              starved
                ? { kind: "silent", afterMs: STREAM_INACTIVITY_MS }
                : { kind: "eof" },
            ),
          );
        }
        return current;
      } catch (error) {
        if (controller.signal.aborted) {
          push(finishScanRun(current, { kind: "cancelled" }));
          return current;
        }
        const detail =
          error instanceof Error && error.message.length > 0
            ? error.message
            : null;
        logger.warn("[scan/github] stream failed", { detail });
        push(finishScanRun(current, { kind: "transport", detail }));
        return current;
      } finally {
        if (watchdog !== null) clearInterval(watchdog);
        inFlightRef.current = false;
        abortRef.current = null;
      }
    },
    [run],
  );

  return { availability, run, start, cancel, reset };
}
