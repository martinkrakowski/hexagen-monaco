import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wizardToManifest } from "../../application/wizard-to-manifest";

// Phase 2: the template's `allowSharedUi` rule shapes the manifest `apps[]`.
// A flexible template (allowSharedUi: true) emits a single shared `web` app;
// a strict template (allowSharedUi: false) emits one isolated `web-<context>`
// app per UI-bearing context. A single aggregated `api` app is emitted either
// way. See docs/planning/wire-architectural-template-into-generation.md (Phase 2).

const asWizard = (x: unknown) =>
  x as unknown as Parameters<typeof wizardToManifest>[0];

interface AppEntry {
  name: string;
  framework?: string;
  depends_on?: string[];
}

const appsOf = (manifest: Record<string, unknown>): AppEntry[] =>
  (manifest.apps as AppEntry[]) ?? [];

const appNames = (manifest: Record<string, unknown>): string[] =>
  appsOf(manifest)
    .map((a) => a.name)
    .sort();

const wizard = (
  template: string,
  contexts: Array<{ name: string; uiFramework?: string }>,
) =>
  asWizard({
    governance: {
      workspaceName: "demo",
      namespacePrefix: "@demo",
      packageManager: "yarn",
      workspaceTemplate: template,
    },
    boundedContexts: contexts.map((c, i) => ({
      id: `ctx-${i}`,
      name: c.name,
      uiFramework: c.uiFramework ?? "Next.js",
    })),
  });

describe("wizardToManifest — allowSharedUi shapes apps[]", () => {
  it("flexible template (modular-monolith) emits a single shared web app", () => {
    const manifest = wizardToManifest(
      wizard("modular-monolith", [{ name: "orders" }, { name: "billing" }]),
    );
    const web = appsOf(manifest).filter((a) => a.name.startsWith("web"));
    assert.deepEqual(
      web.map((a) => a.name),
      ["web"],
      "exactly one aggregated web app",
    );
    assert.ok(web[0].depends_on?.includes("orders"));
    assert.ok(web[0].depends_on?.includes("billing"));
  });

  it("strict template (strict-enterprise) emits one isolated web app per UI-bearing context", () => {
    const manifest = wizardToManifest(
      wizard("strict-enterprise", [{ name: "orders" }, { name: "billing" }]),
    );
    assert.deepEqual(appNames(manifest), ["api", "web-billing", "web-orders"]);
    const webOrders = appsOf(manifest).find((a) => a.name === "web-orders");
    const webBilling = appsOf(manifest).find((a) => a.name === "web-billing");
    assert.deepEqual(
      webOrders?.depends_on,
      ["orders"],
      "web app is isolated to its own context",
    );
    assert.deepEqual(webBilling?.depends_on, ["billing"]);
    assert.ok(
      !appsOf(manifest).some((a) => a.name === "web"),
      "no aggregated shared web app under a strict template",
    );
  });

  it("strict template omits a web app for headless (no-UI) contexts", () => {
    const manifest = wizardToManifest(
      wizard("strict-enterprise", [
        { name: "orders", uiFramework: "Next.js" },
        { name: "reporting", uiFramework: "" },
      ]),
    );
    const webNames = appsOf(manifest)
      .map((a) => a.name)
      .filter((n) => n.startsWith("web"));
    assert.deepEqual(
      webNames,
      ["web-orders"],
      "only the UI-bearing context gets a web app",
    );
  });

  it("always emits a single aggregated api app, under both rules", () => {
    for (const template of ["modular-monolith", "strict-enterprise"]) {
      const manifest = wizardToManifest(
        wizard(template, [{ name: "orders" }, { name: "billing" }]),
      );
      const apis = appsOf(manifest).filter((a) => a.name === "api");
      assert.equal(apis.length, 1, `exactly one api app for ${template}`);
      assert.ok(apis[0].depends_on?.includes("orders"));
      assert.ok(apis[0].depends_on?.includes("billing"));
    }
  });

  it("slugifies per-context app names to a filesystem-safe form", () => {
    // Strict template → per-context web apps; their directory names must be
    // path-safe regardless of the raw context name. (The sync generator also
    // guards against traversal — this just keeps wizard output clean.)
    const manifest = wizardToManifest(
      wizard("strict-enterprise", [
        { name: "Billing & Invoices" },
        { name: "../../etc" },
      ]),
    );
    const webNames = appsOf(manifest)
      .map((a) => a.name)
      .filter((n) => n.startsWith("web"))
      .sort();
    assert.deepEqual(webNames, ["web-billing-invoices", "web-etc"]);
    for (const n of webNames) {
      assert.ok(
        !n.includes("/") && !n.includes("..") && !n.includes(" "),
        `app name must be path-safe, got: ${n}`,
      );
    }
  });

  it("disambiguates app names that slugify to the same value (no context dropped)", () => {
    // "Orders!" and "Orders?" both slugify to "orders"; without disambiguation
    // the generator's first-wins dedup would silently drop the second's app.
    const manifest = wizardToManifest(
      wizard("strict-enterprise", [{ name: "Orders!" }, { name: "Orders?" }]),
    );
    const apps = appsOf(manifest).filter((a) => a.name.startsWith("web"));
    assert.deepEqual(
      apps.map((a) => a.name).sort(),
      ["web-orders", "web-orders-2"],
      "colliding slugs get a deterministic numeric suffix",
    );
    // Both contexts keep an app, each depending on its own (raw) context name.
    assert.deepEqual(apps.find((a) => a.name === "web-orders")?.depends_on, [
      "Orders!",
    ]);
    assert.deepEqual(apps.find((a) => a.name === "web-orders-2")?.depends_on, [
      "Orders?",
    ]);
  });

  it("micro-frontend also emits per-context web apps (same allowSharedUi rule)", () => {
    const manifest = wizardToManifest(
      wizard("micro-frontend", [{ name: "orders" }, { name: "billing" }]),
    );
    assert.deepEqual(appNames(manifest), ["api", "web-billing", "web-orders"]);
  });

  it("falls back to web-app when a context name slugifies to empty", () => {
    // Names with no [a-z0-9] (punctuation-only, or non-ASCII) slug to "" → "app",
    // so the app directory is still valid.
    const manifest = wizardToManifest(
      wizard("strict-enterprise", [{ name: "!!!" }]),
    );
    const webNames = appsOf(manifest)
      .map((a) => a.name)
      .filter((n) => n.startsWith("web"));
    assert.deepEqual(webNames, ["web-app"]);
  });
});
