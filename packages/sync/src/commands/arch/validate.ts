import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  archLinterCommand,
  resolveArchLinterBin,
} from "../../arch-linter-bin.js";
import { getProjectRoot } from "../shared/project-root.js";
import {
  classifyLintRun,
  linterNotFoundOutcome,
  toArchValidateJson,
  type ArchValidateOutcome,
} from "./validate-outcome.js";

const execAsync = promisify(exec);

export async function validateCommand(
  options: { json?: boolean } = {},
): Promise<void> {
  const json = options.json === true;
  const workspaceRoot = getProjectRoot();

  if (!json) {
    console.log("Running architecture validation...\n");
  }

  const bin = resolveArchLinterBin(workspaceRoot);

  let outcome: ArchValidateOutcome;
  let stderr = "";

  if (bin === null) {
    outcome = linterNotFoundOutcome();
  } else {
    let linterExit: number | null;
    let stdout = "";
    try {
      const result = await execAsync(
        archLinterCommand(bin) + (json ? " --json" : ""),
        { cwd: workspaceRoot, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      );
      linterExit = 0;
      stdout = String(result.stdout);
      stderr = String(result.stderr);
    } catch (e) {
      const err = e as { code?: unknown; stdout?: unknown; stderr?: unknown };
      linterExit = typeof err.code === "number" ? err.code : null;
      stdout = String(err.stdout ?? "");
      stderr = String(err.stderr ?? "");
    }
    outcome = classifyLintRun(linterExit, stdout, json);
  }

  if (stderr.trim()) {
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
  }

  process.exitCode = outcome.exitCode;
}
