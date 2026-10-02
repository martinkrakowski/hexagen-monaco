import {
  UNRESOLVED_IMPORT_RULE_ID,
  edgeViolatesRule,
  isPathInSlice,
  nfc,
  type Contract,
  type ContractRule,
  type ObservedEdge,
  type ObservedReport,
  type Slice,
} from "@hexagen/shared";

/**
 * Pure derivation for the middle panel. The edge-rule semantics come from
 * `@hexagen/shared` (`edgeViolatesRule`), the same function `hexagen contract
 * check` uses, so the viewer and the CLI never disagree about an edge.
 * Every name is carried through exactly as `observed.json` has it.
 */

type Section<T> =
  | { readonly collected: true; readonly items: readonly T[] }
  | { readonly collected: false; readonly reason: string };

export type PackageItem = Extract<
  ObservedReport["packages"],
  { collected: true }
>["items"][number];
export type UnresolvedItem = Extract<
  ObservedReport["unresolved"],
  { collected: true }
>["items"][number];

/** The collected items, or `null` plus the reason the section is absent. */
export function itemsOf<T>(
  section: Section<T>,
): { items: readonly T[]; reason: null } | { items: null; reason: string } {
  return section.collected
    ? { items: section.items, reason: null }
    : { items: null, reason: section.reason };
}

function under(root: string, file: string): boolean {
  if (root === ".") return true;
  const r = nfc(root).replace(/\/$/, "");
  const f = nfc(file);
  return f === r || f.startsWith(`${r}/`);
}

/** The package that owns `path` (the longest matching root), as its own name; else the path itself. */
export function ownerLabel(
  packages: readonly PackageItem[],
  path: string,
): string {
  let best: PackageItem | undefined;
  for (const p of packages) {
    if (!under(p.root, path)) continue;
    if (!best || best.root.length < p.root.length) best = p;
  }
  return best ? best.name : path;
}

export interface PackageEdgeGroup {
  readonly from: string;
  readonly to: string;
  readonly edges: readonly ObservedEdge[];
}

/** Edges that cross from one package to another, grouped by the pair, in first-seen order. */
export function packageEdges(
  packages: readonly PackageItem[],
  edges: readonly ObservedEdge[],
): PackageEdgeGroup[] {
  const groups = new Map<
    string,
    { from: string; to: string; edges: ObservedEdge[] }
  >();
  for (const e of edges) {
    const from = ownerLabel(packages, e.from);
    const to = ownerLabel(packages, e.to);
    if (from === to) continue;
    const key = `${from}\u0000${to}`;
    const hit = groups.get(key);
    if (hit) hit.edges.push(e);
    else groups.set(key, { from, to, edges: [e] });
  }
  return [...groups.values()];
}

export interface SliceEdgeView {
  readonly edge: ObservedEdge;
  /** The contract rules this edge breaks. Empty means legal. */
  readonly broken: readonly ContractRule[];
}

export interface SliceUnresolvedView {
  readonly item: UnresolvedItem;
  /** Always the built-in rule, as in `hexagen contract check`. */
  readonly ruleId: string;
}

export interface SliceView {
  readonly edges: readonly SliceEdgeView[];
  readonly unresolved: readonly SliceUnresolvedView[];
}

/** Edges and unresolved imports that start inside the slice, each judged against the contract. */
export function sliceView(
  observed: ObservedReport,
  slice: Slice,
  contract: Contract | null,
): SliceView {
  const rules = contract?.rules ?? [];
  const edges: SliceEdgeView[] = [];
  if (observed.edges.collected) {
    for (const edge of observed.edges.items) {
      if (!isPathInSlice(slice, edge.from)) continue;
      edges.push({
        edge,
        broken: rules.filter((r) => edgeViolatesRule(slice, r, edge)),
      });
    }
  }
  const unresolved: SliceUnresolvedView[] = [];
  if (observed.unresolved.collected) {
    for (const item of observed.unresolved.items) {
      if (isPathInSlice(slice, item.from)) {
        unresolved.push({ item, ruleId: UNRESOLVED_IMPORT_RULE_ID });
      }
    }
  }
  return { edges, unresolved };
}

export interface CodeFile {
  readonly path: string;
  /** The bundle's decoded text, never re-serialised. */
  readonly text: string;
}

/** `slice.json`, `contract.json` and each grant, in that order, as the bundle holds them. */
export function codeFiles(
  texts: ReadonlyMap<string, string>,
  grants: readonly { readonly path: string; readonly text: string }[],
): CodeFile[] {
  const out: CodeFile[] = [];
  for (const path of ["slice.json", "contract.json"]) {
    const text = texts.get(path);
    if (text !== undefined) out.push({ path, text });
  }
  for (const g of grants) out.push({ path: g.path, text: g.text });
  return out;
}
