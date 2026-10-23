/**
 * SIGTERM flush handler for the OTLP telemetry registration
 * (`apps/web/lib/telemetry.node.ts`).
 *
 * Registering any SIGTERM listener disables Node's default "exit on
 * SIGTERM" behaviour, so a naive `process.once("SIGTERM", flush)` swallows
 * the signal: today the process only exits because Next.js registers its
 * own handler; under `NEXT_MANUAL_SIG_HANDLE` or a custom server nothing
 * would ever exit. This handler restores the exit semantics itself:
 *
 * - flush with a hard cap — `Promise.race` of `shutdown()` and a timer —
 *   so a never-resolving exporter cannot hold the process;
 * - then exit 143 (128 + 15) **only when no other SIGTERM listener
 *   remains**; any other listener (e.g. Next.js's) owns the exit.
 *
 * Kept free of OpenTelemetry imports so its test can drive it with a fake
 * process-like emitter without loading the SDK.
 */

/** Hard cap on the flush: after this, the exit decision happens anyway. */
const SIGTERM_FLUSH_TIMEOUT_MS = 2000;

/** Exit code for a SIGTERM-driven exit: 128 + 15 (SIGTERM). */
const SIGTERM_EXIT_CODE = 143;

/** The `process`-shaped surface the handler needs (fakes work in tests). */
export interface SigtermProcessLike {
  once(event: "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGTERM", listener: () => void): unknown;
  listenerCount(event: "SIGTERM"): number;
  exit(code?: number): unknown;
}

/**
 * Registers a one-shot SIGTERM handler on `target` that flushes via
 * `shutdown` (hard-capped), then exits 143 only if it was the last SIGTERM
 * listener — otherwise it does nothing more, so the other listener stays
 * in charge and the signal is never swallowed.
 */
export function installSigtermFlush(
  target: SigtermProcessLike,
  shutdown: () => Promise<unknown>,
): void {
  const handler = (): void => {
    // Remove itself first so listenerCount reflects *other* handlers only
    // (a real `process.once` wrapper is also gone before this runs, but the
    // explicit removal keeps fake emitters honest).
    target.removeListener("SIGTERM", handler);
    void flushWithCap(shutdown).then(() => {
      if (target.listenerCount("SIGTERM") === 0) {
        // Nothing else will exit the process — do it, or Node would sit
        // there forever (a registered listener disabled the default exit).
        target.exit(SIGTERM_EXIT_CODE);
      }
      // Else: another SIGTERM listener exists (Next.js registers one) and
      // owns the exit — do nothing more.
    });
  };
  target.once("SIGTERM", handler);
}

/** Flush, but never for longer than {@link SIGTERM_FLUSH_TIMEOUT_MS}. */
async function flushWithCap(shutdown: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGTERM_FLUSH_TIMEOUT_MS);
  });
  try {
    // A shutdown failure must not block the exit decision either way.
    await Promise.race([
      Promise.resolve()
        .then(shutdown)
        .catch(() => undefined),
      cap,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
