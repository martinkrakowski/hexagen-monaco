import { promisify } from "node:util";
import { exec } from "node:child_process";
import type { SyncConfig } from "./config.js";
import { archLinterCommand, resolveArchLinterBin } from "./arch-linter-bin.js";

const execPromise = promisify(exec);

/**
 * Default wall-clock budget for one arch-linter invocation. Raised from the
 * original 30s: a cold monorepo lint (a ts-morph project load spanning every
 * context) can legitimately approach that ceiling, and under the old
 * swallow-on-timeout behaviour a spurious kill was indistinguishable from a
 * clean pass (AUD-010). Override per-environment via ARCH_LINTER_TIMEOUT_MS.
 */
export const DEFAULT_ARCH_LINTER_TIMEOUT_MS = 60_000;

/**
 * Resolves the arch-linter exec timeout. Honours a positive, finite
 * ARCH_LINTER_TIMEOUT_MS override; falls back to the default for unset or
 * malformed values. Never returns a zero/negative budget — child_process
 * treats those as "no timeout", which would silently disable the guard.
 */
export function resolveLinterTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.ARCH_LINTER_TIMEOUT_MS;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ARCH_LINTER_TIMEOUT_MS;
}

/**
 * True when `error` is child_process's timeout kill rather than a linter
 * verdict. `exec` kills the child with SIGTERM once `timeout` elapses
 * (surfacing `killed: true`); some platforms additionally tag it
 * `code: "ETIMEDOUT"`. A timeout means the linter never reached a conclusion —
 * it is emphatically NOT a pass — so callers must escalate it regardless of
 * strict mode.
 */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as {
    killed?: boolean;
    signal?: string | null;
    code?: unknown;
  };
  return (
    (e.killed === true && e.signal === "SIGTERM") || e.code === "ETIMEDOUT"
  );
}

/**
 * Runs the architectural integrity linter (extracted from old arch-linter sync.ts).
 * Now fully config-driven and crash-proof.
 */
export async function runArchLinter(config: SyncConfig): Promise<void> {
  const { logger, strict, dryRun } = config;

  logger.info("Running Architectural Integrity Linter...");

  if (dryRun) {
    logger.info("[DRY-RUN] would run arch-linter");
    return;
  }

  const timeoutMs = resolveLinterTimeoutMs();

  // Installed arch-linter bin (scope-agnostic) — works in this monorepo and
  // in a generated project (via the @hexagen-monaco/arch-linter devDep),
  // unlike `yarn workspace …` which only resolves here.
  //
  // Resolved OUTSIDE the try below so the strict abort keeps its own message:
  // inside, the catch would relabel it as the generic "failed in strict mode".
  const bin = resolveArchLinterBin(config.workspaceRoot);
  if (bin === null) {
    // A missing bin is "could not verify", exactly like a timeout — and a
    // strict run exists to certify the architecture, so it must not exit 0
    // having checked nothing (AUD-010: the gate must never silently pass).
    // Non-strict runs keep the warn-and-skip behaviour: the linter is an
    // optional devDep in generated projects, where a plain `sync` must still
    // work without it.
    if (strict) {
      throw new Error(
        "arch-linter not installed (@hexagen-monaco/arch-linter) — architecture was NOT verified, " +
          "and --strict cannot certify an unverified tree. Install the linter, or drop --strict.",
      );
    }
    logger.warn(
      "arch-linter not installed (@hexagen-monaco/arch-linter) — skipping architecture validation",
    );
    return;
  }

  try {
    const { stdout, stderr } = await execPromise(archLinterCommand(bin), {
      cwd: config.workspaceRoot,
      timeout: timeoutMs,
    });

    if (stdout) logger.info(stdout.trim());
    if (stderr) logger.error(stderr.trim());

    // The linter's own stdout (relayed above) names what was checked
    // (ADR-0043); this line only marks the sync stage as passed.
    logger.info("✅ Architecture check passed (arch-linter).");
  } catch (error: unknown) {
    // A timeout is "couldn't verify", never "verified clean". Surface it and
    // ALWAYS abort — even in non-strict mode, where a genuine violation is
    // (deliberately) only logged. Swallowing a timeout is precisely the silent
    // false-pass AUD-010 flags.
    if (isTimeoutError(error)) {
      throw new Error(
        `Arch-linter timed out after ${timeoutMs}ms — architecture was NOT verified. ` +
          `Increase the budget via ARCH_LINTER_TIMEOUT_MS if the linter legitimately needs longer.`,
      );
    }

    const message =
      (error instanceof Error &&
        "stderr" in error &&
        (error as { stderr?: string }).stderr) ||
      (error instanceof Error && error.message) ||
      "Unknown linter error";
    logger.error(`Architectural Integrity Check Failed:\n${message}`);

    if (strict) {
      throw new Error("Arch-linter failed in strict mode");
    }
  }
}
