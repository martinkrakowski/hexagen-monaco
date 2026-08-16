import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findMonorepoRoot } from "../../monorepo-root";
import type { ManifestLintOutcome, ManifestLintPort } from "../ports";

/**
 * The only implementation of {@link ManifestLintPort}: hand the candidate
 * manifest to the `arch-linter` CLI and classify what comes back.
 *
 * Everything the `governance/refresh` route used to do inline lives here —
 * temp-file creation, the subprocess, the cleanup — so the route imports
 * neither `node:child_process` nor `node:fs` (enforced by the
 * `no-restricted-imports` block for `app/api/governance/**` in
 * `apps/web/eslint.config.js`).
 *
 * Three behaviours changed in the move, each a defect in the inline version:
 *
 *  1. `execFile`, not `exec`. The old call interpolated a path into a shell
 *     command string (`yarn lint:arch --manifest ${tmpPath}`). `os.tmpdir()`
 *     contains a space on Windows and under some CI images, which silently
 *     split the argument and made the linter read the DEFAULT manifest while
 *     reporting on the submitted one. argv-style spawning has no quoting rules
 *     to get wrong and no shell to interpret metacharacters.
 *
 *  2. `findMonorepoRoot()`, not `process.cwd()`. `lint:arch` is a root-package
 *     script; under the standalone Next build `process.cwd()` is `apps/web`,
 *     where that script does not exist. This is the same anchor AUD-002 (item
 *     1.2) established for every other server-side manifest consumer.
 *
 *  3. A failed subprocess is no longer laundered into architectural
 *     violations. See {@link classify}.
 */

const defaultExecFileAsync = promisify(execFile);

type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * The prefix `createConsoleLogger` in `tools/arch-linter/src/logger.ts` puts on
 * every line, and the banner `reportAndExit` in `tools/arch-linter/src/cli.ts`
 * prints immediately before the violation bullets.
 *
 * These two literals are the contract between the linter's stderr and this
 * adapter's parser. `__tests__/arch-lint-protocol.guard.test.ts` asserts both
 * still appear in the linter's own source, so renaming one there fails a test
 * here instead of degrading this adapter to "everything is unavailable".
 */
export const ARCH_LINT_LOG_PREFIX = "[arch-lint] ";
export const ARCH_LINT_FAILURE_BANNER =
  "Architectural Integrity Check Failed. Found violations:";

/** Bullet prefix used by `fresh.forEach((e) => logger.error(` - ${e.message}`))`. */
const VIOLATION_BULLET = "- ";

interface ExecFailure extends Error {
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  code?: number | string;
  killed?: boolean;
}

/**
 * Turn the linter's stderr into an outcome.
 *
 * Fail-closed by construction: `clean` is reachable ONLY from exit 0, and
 * `violations` ONLY from output that carries the linter's own failure banner.
 * Anything else — a missing binary, an unbuilt `dist/cli.js`, the linter's
 * `FATAL ERROR:` paths, a timeout kill, an unrecognised exit code — is
 * `unavailable`. A future reword of the banner therefore degrades this adapter
 * toward "we do not know", never toward "the architecture is fine".
 *
 * Warning lines (`logger.warn` also writes to stderr: subpath conventions,
 * stale ratchet entries) are dropped rather than promoted: the inline version
 * turned each of them into a HIGH-severity error.
 */
function classify(
  stderr: string,
  fallbackMessage: string,
): ManifestLintOutcome {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line.startsWith(ARCH_LINT_LOG_PREFIX)
        ? line.slice(ARCH_LINT_LOG_PREFIX.length).trim()
        : line,
    );

  const bannerIndex = lines.indexOf(ARCH_LINT_FAILURE_BANNER);
  if (bannerIndex === -1) {
    return {
      kind: "unavailable",
      reason: lines.length > 0 ? lines.join("\n") : fallbackMessage,
    };
  }

  const messages = lines
    .slice(bannerIndex + 1)
    .filter((line) => line.startsWith(VIOLATION_BULLET))
    .map((line) => line.slice(VIOLATION_BULLET.length).trim())
    .filter((line) => line.length > 0);

  // The banner promises violations; if none parsed out, the protocol changed.
  // Reporting "clean" here would be the false-green this classifier exists to
  // prevent, and reporting zero violations under a failure banner is nonsense.
  if (messages.length === 0) {
    return {
      kind: "unavailable",
      reason: `Architecture linter reported violations but none could be read from its output:\n${lines.join("\n")}`,
    };
  }

  return { kind: "violations", messages };
}

export class CliManifestLintAdapter implements ManifestLintPort {
  private readonly execFileAsync: ExecFileAsyncFn;

  constructor(
    private readonly workspaceRoot: string,
    execFileAsyncFn?: ExecFileAsyncFn,
  ) {
    this.execFileAsync =
      execFileAsyncFn ?? (defaultExecFileAsync as unknown as ExecFileAsyncFn);
  }

  /** Anchor on the monorepo root — see note 2 in the class doc. */
  static fromMonorepoRoot(
    execFileAsyncFn?: ExecFileAsyncFn,
  ): CliManifestLintAdapter {
    return new CliManifestLintAdapter(findMonorepoRoot(), execFileAsyncFn);
  }

  async lintManifest(manifestYaml: string): Promise<ManifestLintOutcome> {
    let dir: string;
    try {
      // mkdtemp, not a `Date.now()` filename: two concurrent refreshes a
      // millisecond apart would otherwise share a path and lint each other's
      // manifest (or unlink it mid-run).
      dir = await mkdtemp(path.join(tmpdir(), "hexagen-governance-"));
    } catch (error) {
      return {
        kind: "unavailable",
        reason: `Could not stage the manifest for linting: ${messageOf(error)}`,
      };
    }

    const manifestPath = path.join(dir, "manifest.yaml");
    try {
      await writeFile(manifestPath, manifestYaml, "utf-8");

      await this.execFileAsync(
        "yarn",
        ["lint:arch", "--manifest", manifestPath],
        {
          cwd: this.workspaceRoot,
          timeout: 30_000,
        },
      );
      return { kind: "clean" };
    } catch (error) {
      const failure = error as ExecFailure;
      const stderr = failure.stderr ? String(failure.stderr) : "";
      return classify(stderr, messageOf(error));
    } finally {
      // Best-effort: a leaked temp dir must not turn a successful lint into a
      // failed request.
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
