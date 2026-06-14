import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStage0Prompt } from "../../../src/domain/prompts/generate-manifest.prompt";
import {
  buildGreenfieldArchitectureContext,
  type ArchitectureContext,
} from "../../../src/domain/prompts/build-architecture-context";

// The Stage-0 architecture block is injected UNESCAPED (the user input beside
// it IS escaped), so it is a trust boundary. `ArchitectureContext` is branded:
// only a sanctioned builder may produce one; a raw/user string is a compile
// error. NOTE the extensionless imports above — they keep tsconfig.test.json
// resolving the real (branded) types. The staged-generation tests'
// `.ts`-extension imports resolve to `any`, where @ts-expect-error can't
// enforce the brand.

test("the sanctioned builder produces an ArchitectureContext that compileStage0Prompt injects", () => {
  // The annotation also pins the builder's branded return — a plain-string
  // return would fail here.
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
  compileStage0Prompt({ userDescription: "x" }, "untrusted raw string");
  assert.ok(true); // runtime no-op: tsx strips the brand; the directive is the guarantee
});
