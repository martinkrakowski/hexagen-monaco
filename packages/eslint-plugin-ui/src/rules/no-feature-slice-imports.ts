import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

type MessageIds = "crossSliceImport";

const SHELL_SLICE = "workspace-shell";

/** Candidate roots BEFORE features/ in apps/web/tsconfig.json paths `@/*`. */
const ALIAS_ROOTS_BEFORE_FEATURES = [
  "app",
  "components",
  "lib",
  "hooks",
] as const;

/** Dedicated tsconfig mappings that always resolve outside features/. */
const DEDICATED_ALIAS_FIRST_SEGMENTS = new Set(["contexts", "types"]);

function isDirectory(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

function parseFeaturesPath(
  filePath: string,
): { webRoot: string; sourceSlice: string } | null {
  const idx = filePath.search(/[/\\]features[/\\]/);
  if (idx === -1) return null;
  const webRoot = filePath.slice(0, idx);
  const rest = filePath.slice(idx).replace(/^[/\\]features[/\\]/, "");
  const sourceSlice = rest.split(/[/\\]/)[0];
  if (!sourceSlice) return null;
  return { webRoot, sourceSlice };
}

/**
 * Resolve `@/…` the way apps/web does: first-segment alias roots, then
 * features/. Specifiers that land outside features/ are not cross-slice.
 */
function aliasSliceTarget(
  specifier: string,
  webRoot: string,
): string | null {
  if (!specifier.startsWith("@/")) return null;
  const rest = specifier.slice(2);
  const seg = rest.split("/")[0] ?? "";
  if (!seg) return null;

  if ((ALIAS_ROOTS_BEFORE_FEATURES as readonly string[]).includes(seg)) {
    return null;
  }
  if (DEDICATED_ALIAS_FIRST_SEGMENTS.has(seg)) return null;

  for (const root of ALIAS_ROOTS_BEFORE_FEATURES) {
    if (existsSync(path.join(webRoot, root, seg))) return null;
  }

  const featureDir = path.join(webRoot, "features", seg);
  if (isDirectory(featureDir)) return seg;

  // On the real apps/web tree, missing features/<seg> means this is not a
  // slice. Without that tree (unit tests), fail closed so `@/other-slice`
  // is still visible.
  if (isDirectory(path.join(webRoot, "features"))) return null;
  return seg;
}

function relativeSliceTarget(
  specifier: string,
  filePath: string,
): string | null {
  if (!specifier.startsWith("../") && !specifier.startsWith("./")) return null;
  const resolved = new URL(specifier, `file://${filePath}`).pathname;
  const targetMatch = resolved.match(/features\/([^/]+)/);
  return targetMatch?.[1] ?? null;
}

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow cross-feature-slice imports (relative and @/ alias). Features may not import other features, except workspace-shell as composition root.",
    },
    messages: {
      crossSliceImport:
        'Feature "{{source}}" imports from feature "{{target}}". Features must be isolated — use shared packages or props instead.',
    },
    schema: [],
  },
  create(context) {
    const filePath = context.filename;
    const parsed = parseFeaturesPath(filePath);
    if (!parsed) return {};

    const { webRoot, sourceSlice } = parsed;
    if (sourceSlice === SHELL_SLICE) return {};

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        const source = node.source.value;
        if (typeof source !== "string") return;

        const targetSlice = source.startsWith("@/")
          ? aliasSliceTarget(source, webRoot)
          : relativeSliceTarget(source, filePath);
        if (!targetSlice) return;
        if (targetSlice === sourceSlice) return;
        if (targetSlice === SHELL_SLICE) return;

        context.report({
          node,
          messageId: "crossSliceImport",
          data: { source: sourceSlice, target: targetSlice },
        });
      },
    };
  },
};

export default rule;
