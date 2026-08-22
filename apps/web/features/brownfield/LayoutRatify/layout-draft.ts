/**
 * S3 layout ratification — the pure draft transforms (F-17, BF-4.1).
 *
 * NO React, NO fetch, NO storage. Every function here is a total function over
 * plain data, which is why the whole ratification model can be tested without
 * a DOM and why `LayoutRatifyView` is left with nothing to decide.
 *
 * ## Why this screen exists at all
 *
 * On Tier A the user already ratified in the CLI. On Tiers B and C the SERVER
 * ran the scan with `--yes`, and `--yes` is not a decision: `bootstrap`'s
 * non-interactive path sets `include: true` for EVERY detected package
 * (packages/sync/src/commands/bootstrap/index.ts, the `answersFromDetection`
 * arm) and its own interactive prompt says "These are proposed contexts, not
 * assertions. Include only what you ratify." This screen is where that
 * sentence is finally honoured by a human. The detected mapping is therefore a
 * PROPOSAL, and the model below keeps the proposal and the ratification as two
 * separate fields on every row so "inferred" and "changed" can be told apart
 * on screen instead of being guessed at.
 *
 * ## Why the input type is declared here and not imported
 *
 * The shape mirrors `DetectedPackage` in
 * `packages/sync/src/commands/shared/detect-workspaces.ts`, which is NOT
 * reachable: it is not re-exported from the `@hexagen/sync` barrel, and the
 * module it lives in imports `node:fs`, so pulling it in would drag a Node
 * builtin into a client bundle. It is also not on the wire yet —
 * `ProjectScanResponse` (app/lib/project-scan/types.ts) carries
 * `layoutExcerpt` and nothing structured. Widening the scan response to carry
 * `packages[]` belongs to the route packets, not to this one; this module
 * states the shape it needs so that widening has something to satisfy.
 */
import type {
  BrownfieldLayoutContextDraft,
  BrownfieldLayoutDraft,
} from "../BrownfieldFlow/types";

/**
 * The four layers `detectWorkspaces` probes for, in the order they are shown.
 * Sourced from `LAYER_ALIASES`; the detector records only aliases that EXIST
 * on disk, so an absent layer is a true "not found" and never a low score.
 */
export const LAYOUT_LAYERS = [
  "domain",
  "application",
  "infrastructure",
  "presentation",
] as const;

export type LayoutLayerName = (typeof LAYOUT_LAYERS)[number];

/** Every layer key present, each holding zero or more normalized directories. */
export type LayoutLayerDirectories = Record<LayoutLayerName, string[]>;

/**
 * One detected workspace package, as this screen needs it.
 *
 * `layers` is indexed by an open `string` on purpose: it is parsed from a wire
 * payload, so a future detector layer must not make this a type error on the
 * client. Unknown keys are dropped by `buildLayoutRatifyRows` — see its note.
 */
export interface DetectedPackageSummary {
  /** Repo-relative package root, e.g. `packages/orders`. Row identity. */
  readonly root: string;
  /** The name the detector proposes for the context, e.g. `orders`. */
  readonly name: string;
  readonly layers?: Readonly<Record<string, readonly string[] | undefined>>;
}

/**
 * One editable row.
 *
 * A strict superset of `BrownfieldLayoutContextDraft`: it additionally carries
 * the include decision (a draft holds only what was ratified, so exclusion has
 * no representation there) and the untouched detector proposal (so the view
 * can mark what a human changed). `toLayoutDraft` is the projection back down.
 */
export interface LayoutRatifyRow {
  readonly packageRoot: string;
  readonly contextName: string;
  readonly layerDirectories: LayoutLayerDirectories;
  readonly include: boolean;
  readonly detectedContextName: string;
  readonly detectedLayerDirectories: LayoutLayerDirectories;
}

export type LayoutRowMessageSeverity = "error" | "warning";

export interface LayoutRowMessage {
  readonly severity: LayoutRowMessageSeverity;
  readonly text: string;
}

export interface LayoutRatifyValidation {
  readonly includedCount: number;
  readonly excludedCount: number;
  /** Rows a human renamed or whose layer directories a human edited. */
  readonly editedCount: number;
  readonly errorCount: number;
  /** Per-row inline message, keyed by `packageRoot`. Absent = nothing to say. */
  readonly rowMessages: Readonly<Record<string, LayoutRowMessage>>;
  /**
   * Why "Continue" must stay disabled, phrased for the user, or `null` when it
   * may be enabled. A sentence rather than a boolean because a disabled button
   * with no stated reason is the worst version of this screen.
   */
  readonly blockingReason: string | null;
}

/**
 * Characters rejected in a ratified context name.
 *
 * Deliberately minimal: this rejects what BREAKS the artifact, not what
 * offends taste. `writeLayout` in bootstrap builds `contexts[name] = {...}`,
 * so the name becomes a YAML mapping key and is joined against paths
 * downstream — whitespace, path separators, a YAML `:` and quote characters
 * are the forms that corrupt that. Anything else a user's directory names
 * already produced (dots, dashes, underscores, digits, uppercase) is left
 * alone: a validator that rejected names the detector itself emits would be
 * unusable on the first real repo.
 */
const INVALID_NAME_CHARACTERS = /[\s/\\:"'`]/;

function emptyLayerDirectories(): LayoutLayerDirectories {
  return {
    domain: [],
    application: [],
    infrastructure: [],
    presentation: [],
  };
}

/**
 * One directory string, normalized.
 *
 * Backslashes fold to `/` (a Windows-authored artifact must not create a
 * second spelling of the same directory), a leading `./` and any trailing
 * slash are stripped, and repeated slashes collapse. The result is what a
 * layout entry should contain; `""` means "the user typed nothing usable" and
 * every caller drops it.
 */
export function normalizeDirectory(raw: string): string {
  let value = raw.trim().replace(/\\/g, "/");
  while (value.startsWith("./")) value = value.slice(2);
  value = value.replace(/\/{2,}/g, "/");
  // Trailing slashes only. A bare "/" collapses to "" and is dropped, which is
  // correct: an absolute root is never a valid package-relative layer dir.
  value = value.replace(/\/+$/, "");
  // Reject escapes rather than normalising them away. These strings are
  // written into layout.yaml as layer roots and then path-joined against the
  // package root by the sync engine, whose loader accepts them as-is -- so
  // `../outside` or `/etc` would resolve outside the package the user is
  // ratifying.
  //
  // Rejected BY SEGMENT, not by stripping characters: stripping would silently
  // turn `../src` into `src`, which is a different directory the user did not
  // choose. Empty is the honest answer, and callers already drop empties.
  // (Same lesson as the artifact-path fix in BF-7.1: a dot segment is
  // traversal regardless of what surrounds it.)
  if (value.startsWith("/")) return "";
  if (value.split("/").some((segment) => segment === "..")) return "";
  return value;
}

/**
 * Normalizes a directory list and guarantees: no empty entries, no duplicates,
 * first-occurrence order preserved. `ChipInput` dedupes on its own `values`
 * before calling back, but it compares RAW strings — `src/domain` and
 * `./src/domain/` are two chips there and one directory here, so the dedupe
 * has to happen after normalization or the layout gets both.
 */
export function normalizeDirectories(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = normalizeDirectory(entry);
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sameDirectories(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hasAnyDirectory(layers: LayoutLayerDirectories): boolean {
  return LAYOUT_LAYERS.some((layer) => layers[layer].length > 0);
}

function cloneLayerDirectories(
  layers: LayoutLayerDirectories,
): LayoutLayerDirectories {
  return {
    domain: [...layers.domain],
    application: [...layers.application],
    infrastructure: [...layers.infrastructure],
    presentation: [...layers.presentation],
  };
}

/**
 * Builds the initial ratification rows from what the scan detected.
 *
 * Guarantees:
 *  - one row per package, in detection order (reordering would break the
 *    reader's mapping back onto their own repo layout);
 *  - `packageRoot` is unique — a repeated root is dropped rather than
 *    producing two rows that fight over the same identity;
 *  - every row carries all four layer keys, so the editor never has to
 *    distinguish "absent" from "empty";
 *  - `detected*` fields are independent copies, so later edits cannot mutate
 *    the record of what was proposed.
 *
 * DEFAULT INCLUDE = "the detector found at least one layer directory here".
 * This deliberately diverges from what `bootstrap --yes` already wrote on
 * Tiers B/C (everything included). A blanket include is a non-decision made by
 * a machine, and reproducing it here would make the screen a rubber stamp. A
 * package with no recognised layer directory has no evidence behind it, so it
 * starts unticked — visibly, next to its own row, with the count of excluded
 * rows surfaced by the view so the default cannot pass unnoticed. Nothing is
 * hidden and every default is one click from being overruled.
 *
 * Unknown keys in `layers` are ignored: the editor renders exactly these four
 * layers, and carrying a key the user is never shown into a draft they are
 * asked to ratify would be a lie about what they confirmed.
 */
export function buildLayoutRatifyRows(
  packages: readonly DetectedPackageSummary[],
): readonly LayoutRatifyRow[] {
  const rows: LayoutRatifyRow[] = [];
  const seenRoots = new Set<string>();

  for (const pkg of packages) {
    const normalizedRoot = normalizeDirectory(pkg.root ?? "");
    // The detector emits "." for a single-package repo; keep that spelling
    // rather than inventing an empty root that would render as a blank cell.
    const packageRoot = normalizedRoot === "" ? "." : normalizedRoot;
    if (seenRoots.has(packageRoot)) continue;
    seenRoots.add(packageRoot);

    const layerDirectories = emptyLayerDirectories();
    for (const layer of LAYOUT_LAYERS) {
      layerDirectories[layer] = normalizeDirectories(pkg.layers?.[layer] ?? []);
    }

    const detectedContextName = (pkg.name ?? "").trim();

    rows.push({
      packageRoot,
      contextName: detectedContextName,
      layerDirectories,
      include: hasAnyDirectory(layerDirectories),
      detectedContextName,
      detectedLayerDirectories: cloneLayerDirectories(layerDirectories),
    });
  }

  return rows;
}

/**
 * Replaces one row, preserving object identity everywhere it can.
 *
 * A no-op returns the SAME array reference, and an untouched row keeps its
 * own reference. That is not micro-optimisation: the view feeds `rows`
 * straight into `EntityDataGrid`, and identity is what lets a host memoise
 * without having to diff.
 */
function replaceRow(
  rows: readonly LayoutRatifyRow[],
  packageRoot: string,
  update: (row: LayoutRatifyRow) => LayoutRatifyRow,
): readonly LayoutRatifyRow[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.packageRoot !== packageRoot) return row;
    const updated = update(row);
    if (updated !== row) changed = true;
    return updated;
  });
  return changed ? next : rows;
}

/** Includes or excludes one package. Declining is one click, same as accepting. */
export function setContextIncluded(
  rows: readonly LayoutRatifyRow[],
  packageRoot: string,
  include: boolean,
): readonly LayoutRatifyRow[] {
  return replaceRow(rows, packageRoot, (row) =>
    row.include === include ? row : { ...row, include },
  );
}

/**
 * Renames one context.
 *
 * Stores the value AS TYPED (minus nothing), because trimming or rejecting
 * mid-keystroke fights the user's editor. Whether the value is usable is
 * `validateLayoutRows`' answer, and `toLayoutDraft` is what finally trims it.
 * Splitting those apart is what lets the screen show a live inline error
 * instead of silently refusing input.
 */
export function renameContext(
  rows: readonly LayoutRatifyRow[],
  packageRoot: string,
  contextName: string,
): readonly LayoutRatifyRow[] {
  return replaceRow(rows, packageRoot, (row) =>
    row.contextName === contextName ? row : { ...row, contextName },
  );
}

/** Replaces one layer's directory list, normalized (see `normalizeDirectories`). */
export function setLayerDirectories(
  rows: readonly LayoutRatifyRow[],
  packageRoot: string,
  layer: LayoutLayerName,
  directories: readonly string[],
): readonly LayoutRatifyRow[] {
  const normalized = normalizeDirectories(directories);
  return replaceRow(rows, packageRoot, (row) =>
    sameDirectories(row.layerDirectories[layer], normalized)
      ? row
      : {
          ...row,
          layerDirectories: {
            ...row.layerDirectories,
            [layer]: normalized,
          },
        },
  );
}

/** Restores the detector's proposal for one row, include flag included. */
export function resetRowToDetected(
  rows: readonly LayoutRatifyRow[],
  packageRoot: string,
): readonly LayoutRatifyRow[] {
  return replaceRow(rows, packageRoot, (row) => {
    const detectedLayers = cloneLayerDirectories(row.detectedLayerDirectories);
    if (
      row.contextName === row.detectedContextName &&
      row.include === hasAnyDirectory(detectedLayers) &&
      LAYOUT_LAYERS.every((layer) =>
        sameDirectories(row.layerDirectories[layer], detectedLayers[layer]),
      )
    ) {
      return row;
    }
    return {
      ...row,
      contextName: row.detectedContextName,
      layerDirectories: detectedLayers,
      include: hasAnyDirectory(detectedLayers),
    };
  });
}

/** What a human changed on one row, relative to the detector's proposal. */
export interface LayoutRowChanges {
  readonly renamed: boolean;
  readonly layersEdited: boolean;
}

export function layoutRowChanges(row: LayoutRatifyRow): LayoutRowChanges {
  return {
    renamed: row.contextName.trim() !== row.detectedContextName,
    layersEdited: !LAYOUT_LAYERS.every((layer) =>
      sameDirectories(
        row.layerDirectories[layer],
        row.detectedLayerDirectories[layer],
      ),
    ),
  };
}

export function isLayoutRowEdited(row: LayoutRatifyRow): boolean {
  const changes = layoutRowChanges(row);
  return changes.renamed || changes.layersEdited;
}

/** True when the detector found no layer directory at all for this package. */
export function hasNoDetectedLayers(row: LayoutRatifyRow): boolean {
  return !hasAnyDirectory(row.detectedLayerDirectories);
}

/**
 * The whole validation surface for the screen.
 *
 * Three decisions are encoded here rather than in the view:
 *
 * 1. NAME COLLISIONS ARE CHECKED AMONG INCLUDED ROWS ONLY. An excluded package
 *    is never written, so it cannot collide — which also makes "exclude one of
 *    them" the cheapest resolution, alongside renaming.
 *
 * 2. THE COLLISION CHECK IS CASE-INSENSITIVE, and it is a hard error. In
 *    `writeLayout` the context name is an OBJECT KEY (`contexts[ctx.name]`),
 *    so two identical names do not throw — the second silently overwrites the
 *    first and a whole bounded context disappears from `layout.yaml` with no
 *    message anywhere. Silent loss is the failure mode worth blocking, and
 *    case is folded because `orders` and `Orders` are a defect in every real
 *    repo and are indistinguishable on a case-insensitive filesystem.
 *
 * 3. AN INCLUDED CONTEXT WITH NO LAYER DIRECTORIES IS A WARNING, NOT AN ERROR.
 *    `writeLayout` omits the `layers` key entirely when the detector found
 *    nothing, so a root-only entry is a shape the artifact already supports.
 *    The user is told, and is left to decide.
 */
export function validateLayoutRows(
  rows: readonly LayoutRatifyRow[],
): LayoutRatifyValidation {
  const rowMessages: Record<string, LayoutRowMessage> = {};
  const included = rows.filter((row) => row.include);

  // Fold case once, then look up — an O(n²) scan would be fine at seven rows
  // and wrong the first time someone points this at a 300-package monorepo.
  const rootsByFoldedName = new Map<string, string[]>();
  for (const row of included) {
    const folded = row.contextName.trim().toLowerCase();
    if (folded === "") continue;
    const roots = rootsByFoldedName.get(folded);
    if (roots) roots.push(row.packageRoot);
    else rootsByFoldedName.set(folded, [row.packageRoot]);
  }

  for (const row of included) {
    const name = row.contextName.trim();

    if (name === "") {
      rowMessages[row.packageRoot] = {
        severity: "error",
        text: "Give this context a name, or untick it to leave it out of the layout.",
      };
      continue;
    }

    if (INVALID_NAME_CHARACTERS.test(name)) {
      rowMessages[row.packageRoot] = {
        severity: "error",
        text: "A context name cannot contain spaces, slashes, colons or quotes — it becomes a key in layout.yaml.",
      };
      continue;
    }

    const collidingRoots = (
      rootsByFoldedName.get(name.toLowerCase()) ?? []
    ).filter((root) => root !== row.packageRoot);
    if (collidingRoots.length > 0) {
      rowMessages[row.packageRoot] = {
        severity: "error",
        text: `Another included package already uses this name (${collidingRoots.join(", ")}). Rename one of them, or exclude one — two contexts cannot share a name in layout.yaml.`,
      };
      continue;
    }

    if (!hasAnyDirectory(row.layerDirectories)) {
      rowMessages[row.packageRoot] = {
        severity: "warning",
        text: "No layer directories. This context will be written with its root only — add the directories that hold its code if you know them.",
      };
    }
  }

  const errorCount = Object.values(rowMessages).filter(
    (message) => message.severity === "error",
  ).length;

  const blockingReason = (() => {
    if (rows.length === 0) {
      return "The scan detected no workspace packages, so there is nothing to ratify. Go back and try another way of reading the codebase.";
    }
    if (included.length === 0) {
      // The exact failure the CLI raises for this input:
      // "No contexts were ratified. Nothing was written." Blocking here is not
      // a nicety — a layout with an empty `contexts:` block installs a gate
      // that lints nothing and reports a green check that means nothing, which
      // is worse for a conformance product than no gate at all.
      return "Include at least one package. A layout with no contexts would install a gate that checks nothing and always passes.";
    }
    if (errorCount > 0) {
      return "Fix the highlighted context names before continuing.";
    }
    return null;
  })();

  return {
    includedCount: included.length,
    excludedCount: rows.length - included.length,
    editedCount: rows.filter(isLayoutRowEdited).length,
    errorCount,
    rowMessages,
    blockingReason,
  };
}

/** Whether `toLayoutDraft` may be called and its result handed to the flow. */
export function canRatifyLayout(rows: readonly LayoutRatifyRow[]): boolean {
  return validateLayoutRows(rows).blockingReason === null;
}

/**
 * Projects the editable rows down to the flow's `BrownfieldLayoutDraft`.
 *
 * Guarantees:
 *  - excluded rows do not appear at all;
 *  - names are trimmed;
 *  - a layer with zero directories is OMITTED rather than written as `[]`,
 *    matching `writeLayout`, which sets `entry.layers` only when the detector
 *    found something. An empty array in the artifact would assert "this layer
 *    exists and holds no code", which is a different claim from "not found".
 *
 * Callers must gate on `canRatifyLayout` first: this is a projection, not a
 * validator, and it will happily project a draft with duplicate names.
 */
export function toLayoutDraft(
  rows: readonly LayoutRatifyRow[],
): BrownfieldLayoutDraft {
  const contexts: BrownfieldLayoutContextDraft[] = [];

  for (const row of rows) {
    if (!row.include) continue;
    const layerDirectories: Record<string, string[]> = {};
    for (const layer of LAYOUT_LAYERS) {
      const directories = row.layerDirectories[layer];
      if (directories.length > 0) layerDirectories[layer] = [...directories];
    }
    contexts.push({
      packageRoot: row.packageRoot,
      contextName: row.contextName.trim(),
      layerDirectories,
    });
  }

  return { contexts };
}

/**
 * Re-applies a previously ratified draft onto freshly built rows.
 *
 * This is what makes Back from S4 non-destructive: the machine allows
 * `manifest_ratify -> layout_ratify`, and re-entering S3 must show what the
 * user confirmed, not the detector's proposal again.
 *
 * Rows are matched on `packageRoot`, never on name — the name is the very
 * thing the user may have changed. A row absent from the draft is set to
 * EXCLUDED: a draft holds exactly what was ratified, so absence is a decision
 * that was made, not missing information.
 *
 * Layer keys outside `LAYOUT_LAYERS` are dropped, for the same reason
 * `buildLayoutRatifyRows` drops them: this editor cannot show them, and a
 * ratification screen must not carry through anything it did not display.
 */
export function mergeRatifiedDraft(
  rows: readonly LayoutRatifyRow[],
  draft: BrownfieldLayoutDraft | null | undefined,
): readonly LayoutRatifyRow[] {
  if (!draft || !Array.isArray(draft.contexts)) return rows;

  const byRoot = new Map<string, BrownfieldLayoutContextDraft>();
  for (const context of draft.contexts) {
    if (typeof context?.packageRoot === "string") {
      byRoot.set(context.packageRoot, context);
    }
  }

  return rows.map((row) => {
    const ratified = byRoot.get(row.packageRoot);
    if (!ratified) {
      return row.include ? { ...row, include: false } : row;
    }
    const layerDirectories = emptyLayerDirectories();
    for (const layer of LAYOUT_LAYERS) {
      layerDirectories[layer] = normalizeDirectories(
        ratified.layerDirectories?.[layer] ?? [],
      );
    }
    return {
      ...row,
      include: true,
      contextName: ratified.contextName ?? row.contextName,
      layerDirectories,
    };
  });
}
