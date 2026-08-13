import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { wizardToManifest } from "../../application/wizard-to-manifest";

// Emission defaults for the monorepo block (F2/F8/F15 — vellum findings).
// These are the values every wizard-generated manifest carries; the sync
// generators consume them (tsconfig.ts, package-json.ts, root-files.ts), so a
// silent change here surfaces as a broken first `yarn build`/`lint` in every
// freshly generated project.

const asWizard = (x: unknown) =>
  x as unknown as Parameters<typeof wizardToManifest>[0];

const minimalWizard = () =>
  asWizard({
    governance: {
      workspaceName: "demo",
      namespacePrefix: "@demo",
      packageManager: "yarn",
      workspaceTemplate: "modular-monolith",
    },
    boundedContexts: [{ id: "orders-id", name: "orders" }],
    peerMappings: [],
  });

describe("wizardToManifest — monorepo workspace defaults", () => {
  it("tsConfig declares include:['src'] so tsc has an explicit compile root (F2)", () => {
    const out = wizardToManifest(minimalWizard());
    assert.deepEqual(
      out.monorepo?.workspaceDefaults?.tsConfig?.include,
      ["src"],
      "without an explicit include, the emitted workspace tsconfig compiles nothing deterministic (F2)",
    );
  });

  it("packageJson devDependencies satisfy the emitted eslint.config.js imports (F8)", () => {
    const out = wizardToManifest(minimalWizard());
    const devDeps = (
      out.monorepo?.workspaceDefaults?.packageJson as
        | { devDependencies?: Record<string, string> }
        | undefined
    )?.devDependencies;
    assert.ok(
      devDeps,
      "workspaceDefaults.packageJson.devDependencies must exist",
    );
    // The emitted eslint.config.js imports `@eslint/js` + `typescript-eslint`;
    // each workspace must be lintable standalone (`yarn workspace <pkg> lint`),
    // not only when turbo hoists compatible bins from an app scaffold.
    for (const dep of [
      "typescript",
      "eslint",
      "@eslint/js",
      "typescript-eslint",
    ]) {
      assert.ok(devDeps[dep], `devDependencies must pin ${dep}`);
    }
    for (const stale of [
      "@typescript-eslint/parser",
      "@typescript-eslint/eslint-plugin",
    ]) {
      assert.equal(
        devDeps[stale],
        undefined,
        `${stale} is the legacy eslintrc toolchain — the flat config imports typescript-eslint instead`,
      );
    }
  });

  it("turboConfig pipeline typecheck keeps ^build (F15 makes this pipeline live — TS6305 guard)", () => {
    const out = wizardToManifest(minimalWizard());
    const pipeline = out.monorepo?.turboConfig?.pipeline;
    assert.ok(pipeline, "turboConfig.pipeline must exist");
    assert.deepEqual(
      pipeline.typecheck?.dependsOn,
      ["^build"],
      "since F15 this pipeline replaces the built-in turbo.json tasks; typecheck without ^build hits TS6305 on a fresh clone",
    );
    assert.deepEqual(
      out.monorepo?.turboConfig?.globalDependencies,
      ["**/.env.*"],
      "env files must invalidate the turbo cache",
    );
  });
});
