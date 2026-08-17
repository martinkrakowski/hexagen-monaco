import { execFileSync } from "node:child_process";
import {
  archLinterCommand,
  resolveArchLinterBin,
} from "../../arch-linter-bin.js";
import type { DriftSummary, LintCollector } from "./types.js";

function empty(collected: boolean): DriftSummary {
  return {
    fresh: [],
    baselined: [],
    stale: [],
    expired: [],
    collected,
  };
}

export function createSpawnLintCollector(workspaceRoot: string): LintCollector {
  return {
    collect() {
      const bin = resolveArchLinterBin(workspaceRoot);
      if (bin === null) return empty(false);
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
        const err = error as { stdout?: string; status?: number };
        if (typeof err.stdout === "string" && err.stdout.trim()) {
          try {
            return parseLintJson(err.stdout);
          } catch {
            return empty(false);
          }
        }
        return empty(false);
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
