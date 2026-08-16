/**
 * Yarn constraints — one declared range per shared dependency.
 *
 * Why this exists. A workspace-by-workspace audit (2026-08-15) found **19
 * packages carrying more than one declared range** across the monorepo. Most
 * were harmless untidiness, but the mechanism that produced them is the same one
 * that produced the undeclared-`vitest` bug (#455) and the arch-linter bin gap
 * (#452, AUD-010): a shared tool governed by convention rather than by anything
 * that fails when the convention is broken.
 *
 * Scope is deliberately narrow. `PINNED` covers only dependencies where every
 * declared range already sat within one major, so unifying them cannot change
 * behaviour — it is a statement-of-intent cleanup. Genuine major splits are
 * listed in `KNOWN_SPLITS` below and are NOT enforced here: each needs a human
 * decision, and a constraint that forced them would either be wrong or be
 * disabled the first time it was inconvenient.
 *
 * Run `yarn constraints` to check, `yarn constraints --fix` to apply.
 *
 * Plan: docs/planning/2026-08-15-workspace-dependency-hygiene-followups.md
 */

/**
 * dependency -> the single range every workspace must declare.
 *
 * Chosen as the root manifest's range where root declares it, otherwise the
 * range already in majority use — which in every case here is also the version
 * currently installed, so applying this produced zero resolution changes.
 */
const PINNED = {
  typescript: "^5.4.5",
  tsx: "^4.21.0",
  "@typescript-eslint/eslint-plugin": "^8.57.0",
  "@typescript-eslint/parser": "^8.57.0",
  "typescript-eslint": "^8.0.0",
  "js-yaml": "^4.1.1",
  "@types/js-yaml": "^4.0.9",
  "@modelcontextprotocol/sdk": "^1.29.0",
  zod: "^3.23.8",
  "@hexagen/sync": "workspace:*",
};

/**
 * Deliberately NOT enforced — real major-version splits awaiting a decision.
 * Listed so the omission reads as a decision rather than an oversight. Each is
 * tracked as a D-V gate in the plan named above.
 *
 *   react / @types/react   18 (apps/tui) vs 19          — Ink's peer range may pin tui
 *   zustand                4 (apps/tui) vs 5
 *   @types/node            20 (20 workspaces) vs 22 (root, and CI's runtime)
 *   eslint                 8 (root + 32) vs 9 / 10      — flat config is a migration
 *   @dagrejs/dagre         1 (layout-engine) vs 2
 *   elkjs                  0.9 (layout-engine) vs 0.11
 *   lucide-react           0.453 (apps/web) vs 1
 *   ts-morph               22 (sync) vs 27 (arch-linter)
 *
 * `ts-morph` is additionally owned elsewhere: it is item 3.4 (AUD-012) of the
 * architecture-remediation plan and is release-gated. Do not fold it in here.
 */
const KNOWN_SPLITS = [
  "react",
  "@types/react",
  "zustand",
  "@types/node",
  "eslint",
  "@dagrejs/dagre",
  "elkjs",
  "lucide-react",
  "ts-morph",
];

module.exports = {
  async constraints({ Yarn }) {
    for (const [ident, range] of Object.entries(PINNED)) {
      for (const dependency of Yarn.dependencies({ ident })) {
        // peerDependencies express compatibility, not a resolution choice —
        // forcing them to the pinned range would narrow what a consumer may use.
        if (dependency.type === "peerDependencies") continue;
        dependency.update(range);
      }
    }

    // Guard the guard: if a KNOWN_SPLITS entry ever collapses to one range on
    // its own, it should graduate into PINNED rather than sit here implying a
    // split that no longer exists. Surfaced as an error so the list stays honest.
    for (const ident of KNOWN_SPLITS) {
      const ranges = new Set(
        Yarn.dependencies({ ident })
          .filter((d) => d.type !== "peerDependencies")
          .map((d) => d.range),
      );
      if (ranges.size === 1) {
        Yarn.workspace().error(
          `"${ident}" is listed in KNOWN_SPLITS but now has a single range ` +
            `(${[...ranges][0]}). Move it into PINNED and delete it from the list.`,
        );
      }
    }
  },
};
