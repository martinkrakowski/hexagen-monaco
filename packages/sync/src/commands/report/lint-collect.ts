import { execFileSync } from "node:child_process";
import {
  archLinterCommand,
  resolveArchLinterBin,
} from "../../arch-linter-bin.js";
import type { DriftSummary, LintCollector } from "./types.js";

function empty(collected: boolean, failureReason?: string): DriftSummary {
  return {
    fresh: [],
    baselined: [],
    stale: [],
    expired: [],
    collected,
    failureReason,
  };
}

export function createSpawnLintCollector(workspaceRoot: string): LintCollector {
  return {
    collect() {
      const bin = resolveArchLinterBin(workspaceRoot);
      if (bin === null) {
        return empty(false, "hexagen-lint binary was not found");
      }
      const command = archLinterCommand(bin);
      try {
        const output = execFileSync(command, ["--json", "--ratchet"], {
          cwd: workspaceRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
          shell: process.platform === "win32",
        });
        return parseLintJson(output);
      } catch (error) {
        const err = error as {
          stdout?: string;
          status?: number;
          message?: string;
          code?: string;
        };
        if (typeof err.stdout === "string" && err.stdout.trim()) {
          try {
            return parseLintJson(err.stdout);
          } catch (parseError) {
            return empty(
              false,
              `hexagen-lint output was not valid JSON: ${
                (parseError as Error).message
              }`,
            );
          }
        }
        const reason =
          err.code === "ETIMEDOUT"
            ? "hexagen-lint timed out"
            : (err.message ?? "hexagen-lint failed to start");
        return empty(false, reason);
      }
    },
  };
}

export function parseLintJson(stdout: string): DriftSummary {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .at(-1);
  if (!line) return empty(false);
  const raw = JSON.parse(line) as {
    fresh?: unknown;
    baselined?: unknown;
    stale?: unknown;
    expired?: unknown;
  };
  const asEntries = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((item) => {
          if (
            typeof item !== "object" ||
            item === null ||
            typeof (item as { rule?: unknown }).rule !== "string" ||
            typeof (item as { file?: unknown }).file !== "string"
          ) {
            return [];
          }
          const rec = item as {
            rule: string;
            file: string;
            specifier?: string;
            message?: string;
            reason?: string;
            expires?: string;
          };
          return [
            {
              rule: rec.rule,
              file: rec.file,
              specifier: rec.specifier ?? "",
              message: rec.message ?? "",
              reason: rec.reason,
              expires: rec.expires,
            },
          ];
        })
      : [];
  return {
    fresh: asEntries(raw.fresh),
    baselined: asEntries(raw.baselined),
    stale: asEntries(raw.stale),
    expired: asEntries(raw.expired),
    collected: true,
  };
}
