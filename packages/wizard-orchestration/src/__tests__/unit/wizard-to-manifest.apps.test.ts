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

// Track D Phase 2: the step-1 `infrastructureTarget` selector now drives the
// aggregated `api` app's framework (previously it was inert — deriveApps read
// only the legacy `apiFramework`). `nitro` is the first value with a real
// generator template.
describe("wizardToManifest — api framework from infrastructureTarget", () => {
  const wizardWith = (
    contexts: Array<{
      name: string;
      infrastructureTarget?: string;
      apiFramework?: string;
    }>,
  ) =>
    asWizard({
      governance: {
        workspaceName: "demo",
        namespacePrefix: "@demo",
        packageManager: "yarn",
        workspaceTemplate: "modular-monolith",
      },
      // Headless contexts (no UI) so only the `api` app is in play.
      boundedContexts: contexts.map((c, i) => ({
        id: `ctx-${i}`,
        name: c.name,
        uiFramework: "",
        infrastructureTarget: c.infrastructureTarget,
        apiFramework: c.apiFramework,
      })),
    });

  const apiFrameworkOf = (m: Record<string, unknown>) =>
    appsOf(m).find((a) => a.name === "api")?.framework;

  it("infrastructureTarget 'nitro' makes the api app a Nitro app", () => {
    const m = wizardToManifest(
      wizardWith([{ name: "orders", infrastructureTarget: "nitro" }]),
    );
    assert.equal(apiFrameworkOf(m), "nitro");
  });

  it("prefers nitro when any context picks it (aggregated api app)", () => {
    const m = wizardToManifest(
      wizardWith([
        { name: "orders", infrastructureTarget: "nestjs" },
        { name: "billing", infrastructureTarget: "nitro" },
      ]),
    );
    assert.equal(apiFrameworkOf(m), "nitro");
  });

  it("non-nitro infrastructureTargets fall back to plain-ts (unchanged)", () => {
    for (const target of ["nestjs", "express", "serverless", "plain-ts"]) {
      const m = wizardToManifest(
        wizardWith([{ name: "orders", infrastructureTarget: target }]),
      );
      assert.equal(
        apiFrameworkOf(m),
        "plain-ts",
        `infrastructureTarget=${target}`,
      );
    }
  });

  it("honors legacy apiFramework=Fastify only when infrastructureTarget is absent", () => {
    const m = wizardToManifest(
      wizardWith([{ name: "orders", apiFramework: "Fastify" }]),
    );
    assert.equal(apiFrameworkOf(m), "fastify");
  });

  it("infrastructureTarget=nitro wins over a legacy apiFramework=Fastify", () => {
    const m = wizardToManifest(
      wizardWith([
        {
          name: "orders",
          infrastructureTarget: "nitro",
          apiFramework: "Fastify",
        },
      ]),
    );
    assert.equal(apiFrameworkOf(m), "nitro");
  });

  it("a non-nitro infrastructureTarget shadows a legacy apiFramework=Fastify", () => {
    // infra is set (nestjs) → it wins; the legacy Fastify must NOT leak through.
    const m = wizardToManifest(
      wizardWith([
        {
          name: "orders",
          infrastructureTarget: "nestjs",
          apiFramework: "Fastify",
        },
      ]),
    );
    assert.equal(apiFrameworkOf(m), "plain-ts");
  });

  it("infrastructureTarget 'none' emits NO api app (UI-only project)", () => {
    const m = wizardToManifest(
      wizardWith([
        { name: "orders", infrastructureTarget: "none" },
        { name: "billing", infrastructureTarget: "none" },
      ]),
    );
    assert.equal(
      appsOf(m).some((a) => a.name === "api"),
      false,
      "no context wants an API backend, so the api app must be omitted",
    );
  });

  it("still emits the api app when only SOME contexts opt out of the API", () => {
    const m = wizardToManifest(
      wizardWith([
        { name: "orders", infrastructureTarget: "none" },
        { name: "billing", infrastructureTarget: "nitro" },
      ]),
    );
    // The opted-out context does not suppress the api app, nor influence its
    // framework (nitro wins from the api-bearing context).
    assert.equal(apiFrameworkOf(m), "nitro");
  });
});
