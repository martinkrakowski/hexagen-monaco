import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_HREFS,
  type OnboardingStepId,
  stepHref,
} from "./onboarding-steps.js";

describe("onboarding-steps domain", () => {
  it("has exactly 6 steps, numbered 1 through 6 in flow order", () => {
    assert.strictEqual(ONBOARDING_STEPS.length, 6);
    assert.deepStrictEqual(
      ONBOARDING_STEPS.map((s) => s.step),
      [1, 2, 3, 4, 5, 6],
    );
  });

  it("has unique ids covering every OnboardingStepId", () => {
    const expected: OnboardingStepId[] = [
      "welcome",
      "workspace",
      "org",
      "team",
      "invites",
      "done",
    ];
    const actual = ONBOARDING_STEPS.map((s) => s.id);
    assert.strictEqual(new Set(actual).size, actual.length);
    assert.deepStrictEqual([...actual].sort(), [...expected].sort());
  });

  it("each step has a non-empty label", () => {
    for (const step of ONBOARDING_STEPS) {
      assert.ok(step.label.length > 0, `Empty label for ${step.id}`);
    }
  });

  it("every step has an href under /onboarding/", () => {
    for (const step of ONBOARDING_STEPS) {
      const href = stepHref(step.id);
      assert.ok(
        href.startsWith("/onboarding/"),
        `${step.id} href must live under /onboarding/ (got ${href})`,
      );
    }
  });

  it("stepHref throws on an unknown id (fail fast, stepIndexById precedent)", () => {
    assert.throws(
      () => stepHref("renamed-step" as OnboardingStepId),
      /unknown onboarding step id "renamed-step"/,
    );
  });

  // ---------------------------------------------------------------------
  // Route-existence ratchet, both directions (the creation-path pattern:
  // features/landing/domain/creation-path.test.ts). The ledger and the app
  // router are two declarations of the same flow; neither may drift alone.
  // ---------------------------------------------------------------------

  const onboardingAppDir = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "app",
    "onboarding",
  );

  it("every ledger step has a mounted page.tsx on disk", () => {
    for (const step of ONBOARDING_STEPS) {
      const href = ONBOARDING_STEP_HREFS[step.id];
      const segment = href.replace("/onboarding/", "");
      const pageFile = path.join(onboardingAppDir, segment, "page.tsx");
      assert.ok(
        existsSync(pageFile),
        `${step.id} points at ${href} but ${pageFile} does not exist`,
      );
    }
  });

  it("every mounted onboarding route is a ledger step", () => {
    const routedSegments = readdirSync(onboardingAppDir)
      .filter((entry) =>
        statSync(path.join(onboardingAppDir, entry)).isDirectory(),
      )
      .filter((entry) =>
        existsSync(path.join(onboardingAppDir, entry, "page.tsx")),
      )
      .sort();
    const ledgerSegments = ONBOARDING_STEPS.map((s) =>
      ONBOARDING_STEP_HREFS[s.id].replace("/onboarding/", ""),
    ).sort();
    assert.deepStrictEqual(
      routedSegments,
      ledgerSegments,
      "a mounted /onboarding route exists that the step ledger does not know (or vice versa)",
    );
  });
});
