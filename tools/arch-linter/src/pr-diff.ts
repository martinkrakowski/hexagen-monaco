/**
 * Per-PR baseline diff (FDE kit 1.2).
 *
 * The ratchet identity is `rule|file|specifier`. A rename changes `file`, so
 * a baselined finding looks new and the old entry looks stale. This module
 * remaps the *base-branch* baseline through git renames before comparing.
 *
 * Also machine-enforces baseline growth: a key in the current baseline that
 * is not in the remapped base baseline is growth, and fails the gate. Until
 * this landed that property was review-enforced only (ADR-0054 §1).
 */

import {
  parseBaseline,
  violationKey,
  type BaselineEntry,
  type ViolationRecord,
} from "./ratchet-baseline.js";

export interface Rename {
  from: string;
  to: string;
}

export interface PrDiffInput {
  currentViolations: ViolationRecord[];
  currentBaseline: BaselineEntry[];
  baseBaseline: BaselineEntry[];
  renames: Rename[];
}

export interface PrDiffResult {
  /** Current-tree violations whose remapped key is absent from the base baseline. */
  introduced: ViolationRecord[];
  /** Current baseline keys that the remapped base baseline does not contain. */
  baselineGrowth: BaselineEntry[];
  remappedBase: BaselineEntry[];
}

export function remapEntry(
  entry: BaselineEntry,
  renames: Rename[],
): BaselineEntry {
  let file = entry.file;
  for (const rename of renames) {
    if (file === rename.from) {
      file = rename.to;
    }
  }
  return file === entry.file ? entry : { ...entry, file };
}

export function computePrDiff(input: PrDiffInput): PrDiffResult {
  const remappedBase = input.baseBaseline.map((entry) =>
    remapEntry(entry, input.renames),
  );
  const baseKeys = new Set(remappedBase.map(violationKey));
  const introduced = input.currentViolations.filter(
    (violation) => !baseKeys.has(violationKey(violation)),
  );
  const baselineGrowth = input.currentBaseline.filter(
    (entry) => !baseKeys.has(violationKey(entry)),
  );
  return { introduced, baselineGrowth, remappedBase };
}

/**
 * Parse `git diff --name-status --find-renames` output. Only `R*` rows count;
 * copies (`C*`) are ignored so a copied file does not steal the original's
 * suppression.
 */
export function parseRenameNameStatus(gitOutput: string): Rename[] {
  const renames: Rename[] = [];
  for (const raw of gitOutput.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    const tab = line.split("\t");
    if (tab.length < 3) continue;
    const status = tab[0] ?? "";
    if (!/^R\d{0,3}$/.test(status)) continue;
    const from = tab[1];
    const to = tab[2];
    if (from && to) renames.push({ from, to });
  }
  return renames;
}

export function parseBaseBaselineText(text: string | null): BaselineEntry[] {
  if (text === null || text.trim() === "") return [];
  return parseBaseline(text).entries;
}

export function formatPrComment(input: {
  introduced: ViolationRecord[];
  baselineGrowth: BaselineEntry[];
  expired: BaselineEntry[];
}): string | null {
  const { introduced, baselineGrowth, expired } = input;
  if (
    introduced.length === 0 &&
    baselineGrowth.length === 0 &&
    expired.length === 0
  ) {
    return null;
  }

  const lines: string[] = [
    "<!-- hexagen-conformance -->",
    "## Hexagen conformance",
    "",
    "Only findings **introduced by this PR** are listed. Pre-existing baseline",
    "entries are not repeated.",
    "",
  ];

  if (introduced.length > 0) {
    lines.push(`### New violations (${introduced.length})`, "");
    for (const v of introduced) {
      const spec = v.specifier ? ` \`${v.specifier}\`` : "";
      lines.push(`- \`${v.rule}\` in \`${v.file}\`${spec}`);
      if (v.message) {
        const first = v.message.split("\n")[0]?.trim();
        if (first) lines.push(`  ${first}`);
      }
    }
    lines.push("");
  }

  if (baselineGrowth.length > 0) {
    lines.push(
      `### Baseline growth (${baselineGrowth.length})`,
      "",
      "The baseline may only shrink. Remove these entries or fix the finding.",
      "",
    );
    for (const e of baselineGrowth) {
      const spec = e.specifier ? ` \`${e.specifier}\`` : "";
      lines.push(`- \`${e.rule}\` \`${e.file}\`${spec}`);
    }
    lines.push("");
  }

  if (expired.length > 0) {
    lines.push(`### Expired suppressions (${expired.length})`, "");
    for (const e of expired) {
      lines.push(
        `- \`${e.rule}\` \`${e.file}\` expired ${e.expires ?? "?"}${e.reason ? ` — ${e.reason}` : ""}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
