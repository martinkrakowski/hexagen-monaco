import { test } from "vitest";
import assert from "node:assert/strict";
import { compileStage0Prompt } from "../../../src/domain/prompts/generate-manifest.prompt";
import {
  buildGreenfieldArchitectureContext,
  type ArchitectureContext,
} from "../../../src/domain/prompts/build-architecture-context";

// The Stage-0 `<architecture>` block is injected UNESCAPED (the user input
// beside it IS escaped — see compileStage0Prompt), so it is a trust boundary.
// `ArchitectureContext` is branded: only buildGreenfieldArchitectureContext
// produces one; a raw / user string is a compile error at every carrier —
// compileStage0Prompt, the ExecutePromptNormalizationUseCase ctor, and
// FullStagedGenerationOptions all type the parameter as ArchitectureContext.
//
// WHERE THE BRAND IS ENFORCED: the src `typecheck` gate — `turbo run typecheck`,
// run in CI by publish.yml + sync-integrity.yml — covers production code and the
// external API, so no production caller can pass a raw string to the seam. This
// file is a local / documentation guard, NOT a CI gate: it runs via tsx (which
// strips the @ts-expect-error below), and `typecheck:test` — the only command
// that honours the directive — is run by no workflow.
//
// Imports are extensionless only to keep this file free of TS5097 noise under
// tsconfig.test.json (a `.ts` extension still FIRES the brand — it just adds a
// TS5097 per import). The @ts-expect-error below goes vacuous (TS2578) only if
// the brand itself is weakened; no import shape defeats it.

test("the sanctioned builder produces an ArchitectureContext that compileStage0Prompt injects", () => {
  const ctx: ArchitectureContext = buildGreenfieldArchitectureContext();
  assert.ok(
    compileStage0Prompt({ userDescription: "x" }, ctx).includes(
      "<architecture>",
    ),
  );
});

test("a raw string is rejected as architectureContext (brand guards the unescaped seam)", () => {
  // @ts-expect-error - a plain string is not an ArchitectureContext. Weakening
  // the brand back to plain string fails the build here (TS2578).
  compileStage0Prompt({ userDescription: "x" }, "raw");
  assert.ok(true); // runtime no-op: tsx strips the directive; the guarantee is compile-time
});
