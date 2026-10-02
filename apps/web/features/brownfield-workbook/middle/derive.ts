import {
  UNRESOLVED_IMPORT_RULE_ID,
  edgeViolatesRule,
  edgesComplete,
  findKnownViolation,
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

const stripSlash = (root: string): string => nfc(root).replace(/\/$/, "");

export interface OwnerIndex {
  /** The package that owns `path` (the longest matching root). `key` is its root, so two packages with the same name stay apart; `label` is its own name. A path no package owns is its own key and label. */
  readonly of: (path: string) => { key: string; label: string };
}

/**
 * A root lookup built once per package list: each root maps to its first
 * package, and a path is resolved by walking its ancestor directories from the
 * longest, so the longest matching root wins at a cost of one lookup per path
 * segment, not one per package. The root package (".") owns whatever is left.
 */
export function ownerIndex(packages: readonly PackageItem[]): OwnerIndex {
  const byRoot = new Map<string, PackageItem>();
  let rootPackage: PackageItem | undefined;
  for (const p of packages) {
    if (p.root === ".") {
      rootPackage ??= p;
      continue;
    }
    const r = stripSlash(p.root);
    if (!byRoot.has(r)) byRoot.set(r, p);
  }
  const owner = (pkg: PackageItem) => ({
    key: `root:${pkg.root}`,
    label: pkg.name,
  });
  return {
    of(path) {
      const f = nfc(path);
      let end = f.length;
      for (;;) {
        const hit = byRoot.get(f.slice(0, end));
        if (hit) return owner(hit);
        end = f.lastIndexOf("/", end - 1);
        if (end <= 0) break;
      }
      return rootPackage
        ? owner(rootPackage)
        : { key: `path:${path}`, label: path };
    },
  };
}

/** One-off lookup; prefer `ownerIndex` when resolving many paths. */
export function ownerOf(
  packages: readonly PackageItem[],
  path: string,
): { key: string; label: string } {
  return ownerIndex(packages).of(path);
}

export interface PackageEdgeGroup {
  readonly from: string;
  readonly to: string;
  readonly edges: readonly ObservedEdge[];
}

/** Edges that cross from one package to another, grouped by root pair, in first-seen order. */
export function packageEdges(
  packages: readonly PackageItem[],
  edges: readonly ObservedEdge[],
): PackageEdgeGroup[] {
  const owners = ownerIndex(packages);
  const groups = new Map<
    string,
    { from: string; to: string; edges: ObservedEdge[] }
  >();
  for (const e of edges) {
    const from = owners.of(e.from);
    const to = owners.of(e.to);
    if (from.key === to.key) continue;
    const key = `${from.key}\u0000${to.key}`;
    const hit = groups.get(key);
    if (hit) hit.edges.push(e);
    else groups.set(key, { from: from.label, to: to.label, edges: [e] });
  }
  return [...groups.values()];
}

/** A baseline entry that covers a violation at the bundle's date. */
export interface KnownMark {
  readonly expires: string | undefined;
}

export interface BrokenRule {
  readonly rule: ContractRule;
  readonly known: KnownMark | null;
}

export interface SliceEdgeView {
  readonly edge: ObservedEdge;
  /** The contract rules this edge breaks. Empty means legal. */
  readonly broken: readonly BrokenRule[];
}

export interface SliceUnresolvedView {
  readonly item: UnresolvedItem;
  /** Always the built-in rule, as in `hexagen contract check`. */
  readonly ruleId: string;
  readonly known: KnownMark | null;
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
  /** The date expiries are judged against: the bundle's, never the wall clock. */
  now: Date,
): SliceView {
  const known = (v: {
    rule: string;
    file: string;
    specifier: string;
  }): KnownMark | null => {
    const k = findKnownViolation(contract ?? undefined, v, now);
    return k ? { expires: k.expires } : null;
  };
  const rules = contract?.rules ?? [];
  const edges: SliceEdgeView[] = [];
  if (observed.edges.collected) {
    for (const edge of observed.edges.items) {
      if (!isPathInSlice(slice, edge.from)) continue;
      edges.push({
        edge,
        broken: rules
          .filter((r) => edgeViolatesRule(slice, r, edge))
          .map((rule) => ({
            rule,
            known: known({
              rule: rule.id,
              file: edge.from,
              specifier: edge.specifier,
            }),
          })),
      });
    }
  }
  const unresolved: SliceUnresolvedView[] = [];
  if (observed.unresolved.collected) {
    for (const item of observed.unresolved.items) {
      if (isPathInSlice(slice, item.from)) {
        unresolved.push({
          item,
          ruleId: UNRESOLVED_IMPORT_RULE_ID,
          known: known({
            rule: UNRESOLVED_IMPORT_RULE_ID,
            file: item.from,
            specifier: item.specifier,
          }),
        });
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

/** Why `hexagen contract check` would not call this bundle clean: the same conditions it reports. */
export function incompleteReasons(observed: ObservedReport): string[] {
  const out: string[] = [];
  const { edges, unresolved } = observed;
  if (!edges.collected) {
    out.push(
      `the check cannot be clean: edges were not collected (${edges.reason})`,
    );
  } else if (!unresolved.collected) {
    out.push(
      `the check cannot be clean: unresolved imports were not collected (${unresolved.reason})`,
    );
  }
  if (edges.collected && !edgesComplete(edges)) {
    for (const ext of edges.unreadLanguages) {
      out.push(
        `\`hexagen contract check\` would also flag every in-slice .${ext} file; this bundle cannot list them`,
      );
    }
  }
  return out;
}

/** Notices about a slice, contract and observed report that do not belong together. */
export function mismatchNotices(
  observed: ObservedReport | null,
  slice: Slice | null,
  contract: Contract | null,
): string[] {
  const out: string[] = [];
  if (slice && contract && contract.sliceId !== slice.id) {
    out.push(
      `the contract is for slice "${contract.sliceId}", but the slice is "${slice.id}"`,
    );
  }
  if (slice && observed && observed.repo.commit !== slice.repo.commit) {
    out.push(
      `the observed report is at commit ${observed.repo.commit}, but the slice is at ${slice.repo.commit}`,
    );
  }
  return out;
}

/** Number of CRLF line endings in `text`. */
export function crlfCount(text: string): number {
  return text.split("\r\n").length - 1;
}

/** True when the contract belongs to this slice: only then may its rules be applied. */
export function contractApplies(
  slice: Slice,
  contract: Contract | null,
): boolean {
  return contract !== null && contract.sliceId === slice.id;
}
