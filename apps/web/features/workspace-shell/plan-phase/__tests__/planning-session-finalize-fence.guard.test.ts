import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

/**
 * GOD-007 enforcement, item 8.6.
 *
 * `usePlanningSession` owned the proposer⇄critic loop AND the finalize/distill
 * view-model (`FinalizeUiState`, `distillAbortRef`, `startFinalize`,
 * `abandonFinalize`, `setFinalizeReviewText`). The finalize half now lives in
 * `usePlanningFinalize`.
 *
 * Two independent locks keep it there:
 *
 *  1. TYPE — `UsePlanningSessionReturn` declares the four finalize members as
 *     `?: never`, so returning them again from the loop hook is a compile
 *     error (covered by `tsc --noEmit`, not by this suite).
 *  2. LINT — the block asserted here. `apps/web/eslint.config.js` fences the
 *     `session/` directory off from `./distill` and `./usePlanningFinalize`,
 *     with `usePlanningFinalize.ts` itself the only exemption. This lives in
 *     the shipped config rather than in a test because a lint rule cannot be
 *     satisfied by deleting an assertion. It takes TWO rules: static imports and
 *     re-exports are `no-restricted-imports`, while dynamic `import()` needs
 *     `no-restricted-syntax` — `no-restricted-imports` visits only
 *     ImportDeclaration / ExportNamedDeclaration / ExportAllDeclaration and is
 *     blind to `ImportExpression`.
 *
 * The suite runs the REAL `apps/web/eslint.config.js` — it is a test of the
 * shipped gate, not of a copy of its intent.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// __tests__ → plan-phase → workspace-shell → features → apps/web
const APP_DIR = path.resolve(HERE, "../../../..");
const SESSION_DIR = path.join(
  APP_DIR,
  "features/workspace-shell/plan-phase/session",
);

/** A path inside the fenced directory that does not exist on disk — flat
 *  config selects rules by path, so this is enough to probe the fence. */
const PROBE = path.join(SESSION_DIR, "fence-probe.ts");
/** The scoped block covers `**\/*.{ts,tsx}`; narrowing it to `*.ts` would leave
 *  a `.tsx` module dropped into `session/` unfenced. */
const PROBE_TSX = path.join(SESSION_DIR, "fence-probe.tsx");

function makeEslint(): ESLint {
  return new ESLint({ cwd: APP_DIR });
}

/**
 * Messages from BOTH fence rules. The static half is `no-restricted-imports`;
 * the dynamic half has to be `no-restricted-syntax`, because
 * `no-restricted-imports` only visits ImportDeclaration /
 * ExportNamedDeclaration / ExportAllDeclaration and is therefore blind to
 * `await import("./distill")` (measured). Collecting both also strengthens the
 * anti-vacuity rows below, which assert an EMPTY message list.
 */
async function restrictedImportMessages(
  code: string,
  filePath: string,
): Promise<string[]> {
  const [result] = await makeEslint().lintText(code, { filePath });
  return result.messages
    .filter(
      (m) =>
        m.ruleId === "no-restricted-imports" ||
        m.ruleId === "no-restricted-syntax",
    )
    .map((m) => m.message);
}

/**
 * Every legal SPELLING of the two fenced modules, from inside `session/`.
 * `no-restricted-imports` matches the import STRING, not the resolved file, so
 * a fence is only as wide as its list of spellings — and probing just the
 * `./x` form would leave the deep-relative and `@/` alias forms free to be
 * narrowed away while this suite stayed green.
 *
 * `@/*` maps to `./features/*` AND to five other roots (see apps/web/tsconfig
 * `paths`), so BOTH alias depths below resolve to the fenced module and both
 * have to be covered.
 *
 * Measured on the shipped config: `**\/plan-phase/session/<mod>` is the
 * load-bearing spelling — it alone covers rows 3-5. `@/*\/plan-phase/session/
 * <mod>` is a redundant belt that only ever matches row 4. Dropping the `**`
 * entry and keeping the `@/*` one leaves rows 3 and 5 ALLOWED (verified), which
 * is exactly the silent narrowing these rows now catch.
 */
const FENCED_SPELLINGS = (module: string) => [
  `./${module}`,
  `../${module}`,
  `../../plan-phase/session/${module}`,
  `@/workspace-shell/plan-phase/session/${module}`,
  `@/features/workspace-shell/plan-phase/session/${module}`,
];

describe("plan-phase session/ finalize fence (GOD-007)", () => {
  for (const module of ["distill", "usePlanningFinalize"]) {
    for (const spelling of FENCED_SPELLINGS(module)) {
      it(`bans "${spelling}" from the session directory`, async () => {
        const messages = await restrictedImportMessages(
          `import * as fenced from "${spelling}";\nexport const f = fenced;\n`,
          PROBE,
        );
        assert.ok(
          messages.some((m) => /GOD-007/.test(m)),
          `expected a GOD-007 no-restricted-imports error, got: ${JSON.stringify(messages)}`,
        );
      });

      // DYNAMIC form of the same spelling. `no-restricted-imports` does not
      // visit `ImportExpression` at all, so before the companion
      // `no-restricted-syntax` selector every row below was ALLOWED (measured) —
      // one `await import(…)` walked straight through the fence.
      it(`bans a dynamic import("${spelling}") from the session directory`, async () => {
        const messages = await restrictedImportMessages(
          `export const load = () => import("${spelling}");\n`,
          PROBE,
        );
        assert.ok(
          messages.some((m) => /GOD-007/.test(m)),
          `expected a GOD-007 error for a dynamic import, got: ${JSON.stringify(messages)}`,
        );
      });
    }
  }

  it("bans a template-literal dynamic-import specifier", async () => {
    // A pattern/regex fence can only see a LITERAL specifier, so the second
    // selector requires one. Without it, "import(`./distill`)" is an exact
    // bypass of every row above.
    const messages = await restrictedImportMessages(
      "export const load = () => import(`./distill`);\n",
      PROBE,
    );
    assert.ok(
      messages.some((m) => /GOD-007/.test(m)),
      `expected a GOD-007 error for a template-literal specifier, got: ${JSON.stringify(messages)}`,
    );
  });

  it("bans a computed dynamic-import specifier", async () => {
    const messages = await restrictedImportMessages(
      'const target = "./distill";\nexport const load = () => import(target);\n',
      PROBE,
    );
    assert.ok(
      messages.some((m) => /GOD-007/.test(m)),
      `expected a GOD-007 error for a computed specifier, got: ${JSON.stringify(messages)}`,
    );
  });

  it("fences a .tsx module dropped into the session directory", async () => {
    // The scoped block's `files` glob is `**\/*.{ts,tsx}`. Narrowing it to
    // `*.ts` would leave a `.tsx` module in `session/` completely unfenced while
    // every other row here stayed green.
    const messages = await restrictedImportMessages(
      'import { buildDistillPrompt } from "./distill";\nexport const p = buildDistillPrompt;\n',
      PROBE_TSX,
    );
    assert.ok(
      messages.some((m) => /GOD-007/.test(m)),
      `expected the fence to cover ${PROBE_TSX}, got: ${JSON.stringify(messages)}`,
    );
  });

  it("keeps the ADR-0021 @hexagen/local-llm ACL inside the scoped block", async () => {
    // Flat config REPLACES `no-restricted-imports` options rather than merging
    // them, so a scoped block that forgets the app-wide ACL silently exempts
    // its whole directory from ADR-0021. Assert the ACL still bites here.
    // A VALUE import: the ACL entry sets `allowTypeImports: true`, so only a
    // value import trips it.
    //
    // The name is ASSEMBLED rather than written out: layer 3 of the firewall
    // (`scripts/validate-ui-boundary.sh`) greps apps/web sources for a named
    // import of either @internal ACL symbol, and would score this probe string
    // as a real ADR-0021 violation. Splitting the identifier keeps the probe
    // out of that grep without weakening what ESLint sees.
    const aclName = "LLM" + "Message";
    const messages = await restrictedImportMessages(
      `import { ${aclName} } from "@hexagen/local-llm";\nexport const m = ${aclName};\n`,
      PROBE,
    );
    assert.ok(
      messages.some((m) => /ADR 0021/.test(m)),
      `expected the ADR-0021 ACL to apply at ${PROBE}, got: ${JSON.stringify(messages)}`,
    );
  });

  it("does not blanket-ban the session directory's own modules", async () => {
    // Anti-vacuity for the assertions above: they would all pass if the block
    // banned everything. A legitimate sibling import must stay clean.
    const messages = await restrictedImportMessages(
      'import { buildFold } from "./fold";\nexport const f = buildFold;\n',
      PROBE,
    );
    assert.deepStrictEqual(
      messages,
      [],
      "a sibling loop module must remain importable inside session/",
    );
  });

  it("does not blanket-ban dynamic imports inside the session directory", async () => {
    // Anti-vacuity for the dynamic rows: a selector matching every
    // ImportExpression would satisfy all of them. Only the two fenced modules
    // are off-limits; a literal dynamic import of a sibling stays clean.
    const messages = await restrictedImportMessages(
      'export const load = () => import("./fold");\n',
      PROBE,
    );
    assert.deepStrictEqual(
      messages,
      [],
      "a sibling loop module must stay dynamically importable inside session/",
    );
  });

  it("exempts usePlanningFinalize.ts itself — it OWNS the distill", async () => {
    const messages = await restrictedImportMessages(
      'import { buildDistillPrompt } from "./distill";\nexport const p = buildDistillPrompt;\n',
      path.join(SESSION_DIR, "usePlanningFinalize.ts"),
    );
    assert.deepStrictEqual(
      messages,
      [],
      "the finalize hook is the distill's one legitimate consumer",
    );
  });

  it("passes the fence over the real session sources", async () => {
    // `{ts,tsx}`, matching the scoped block's own `files` glob: the directory is
    // all-`.ts` today, but a `.tsx` added later must be linted here rather than
    // silently skipped.
    const results = await makeEslint().lintFiles([
      path.join(SESSION_DIR, "*.{ts,tsx}"),
    ]);
    // Anti-vacuity floor: a renamed/moved directory would lint ZERO files and
    // report "clean" over an empty set. The directory holds the loop hook, the
    // finalize hook and their pure helpers.
    const linted = results.map((r) => path.basename(r.filePath)).sort();
    assert.ok(
      linted.length >= 7,
      `expected the session directory to yield >= 7 linted files, got ${linted.length}: ${linted.join(", ")}`,
    );
    assert.ok(
      linted.includes("usePlanningSession.ts"),
      `usePlanningSession.ts must be in the linted set: ${linted.join(", ")}`,
    );
    assert.ok(
      linted.includes("usePlanningFinalize.ts"),
      `usePlanningFinalize.ts must be in the linted set: ${linted.join(", ")}`,
    );

    const violations = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === "no-restricted-imports")
        .map((m) => `${path.basename(r.filePath)}:${m.line} ${m.message}`),
    );
    assert.deepStrictEqual(violations, []);
  });
});
