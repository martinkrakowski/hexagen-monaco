import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  archLinterCommand,
  resolveArchLinterBin,
} from "../../arch-linter-bin.js";
import { findProjectRoot } from "../shared/project-root.js";
import {
  classifyLintRun,
  linterNotFoundOutcome,
  noManifestOutcome,
  toArchValidateJson,
  type ArchValidateOutcome,
} from "./validate-outcome.js";

const execAsync = promisify(exec);

export async function validateCommand(
  options: { json?: boolean } = {},
): Promise<void> {
  const json = options.json === true;
  const workspaceRoot = findProjectRoot(process.cwd());

  let outcome: ArchValidateOutcome;
  let stderr = "";

  if (workspaceRoot === null) {
    outcome = noManifestOutcome(process.cwd());
  } else {
    if (!json) {
      console.log("Running architecture validation...\n");
    }

    const bin = resolveArchLinterBin(workspaceRoot);

    if (bin === null) {
      outcome = linterNotFoundOutcome();
    } else {
      let linterExit: number | null;
      let stdout = "";
      try {
        // Always --json, in human mode too: an exit 1 with no readable line
        // (a crashed linter) is detectable in both modes. Only the
        // classification reads the JSON line; the rendering reads stderr.
        const result = await execAsync(archLinterCommand(bin) + " --json", {
          cwd: workspaceRoot,
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
        });
        linterExit = 0;
        stdout = String(result.stdout);
        stderr = String(result.stderr);
      } catch (e) {
        const err = e as { code?: unknown; stdout?: unknown; stderr?: unknown };
        linterExit = typeof err.code === "number" ? err.code : null;
        stdout = String(err.stdout ?? "");
        stderr = String(err.stderr ?? "");
      }
      outcome = classifyLintRun(linterExit, stdout, true);
    }
  }

  // Raw stderr is relayed only in --json mode; human mode renders the same
  // lines once, as the numbered list below — never both.
  if (json && stderr.trim()) {
    process.stderr.write(stderr.endsWith("\n") ? stderr : stderr + "\n");
  }

  if (json) {
    process.stdout.write(toArchValidateJson(outcome) + "\n");
    process.exitCode = outcome.exitCode;
    return;
  }

  if (outcome.status === "compliant") {
    console.log(
      "✅ Architecture is compliant (arch-linter: cross-context imports via manifest depends_on + linter-config, layer rules, subpath conventions, server markers, required communication).",
    );
  } else if (outcome.status === "violations") {
    console.warn("⚠️  Architecture violations detected:\n");
    const lines = stderr.split("\n").filter((line) => line.trim() !== "");
    lines.forEach((line, i) => {
      console.warn(`  ${i + 1}. ${line}`);
    });
    console.log("");
  } else {
    console.error(
      "❌ Could not run the architecture linter — nothing was checked: " +
        outcome.reason,
    );
    const lines = stderr.split("\n").filter((line) => line.trim() !== "");
    lines.forEach((line, i) => {
      console.error(`  ${i + 1}. ${line}`);
    });
  }

  process.exitCode = outcome.exitCode;
}
