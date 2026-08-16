import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { createInMemoryMaterializer } from "../../src/in-memory.js";
import { TEMPLATE_MANIFESTS } from "../../src/infrastructure/generated/template-bundle.generated.js";

/**
 * ADR-0053 — ports own their failure channel; no emitted domain/application
 * file may reach into `infrastructure/`, and a port may not be declared inside
 * the infrastructure layer.
 *
 * Scope note: this walks the MATERIALIZED output of every template (through the
 * generated bundle, i.e. the same bytes the web generation path ships), not the
 * `templates/` sources — so a template edit that never reaches the bundle, or a
 * bundle hand-edit that never reaches a template, both fail here.
 */

const LAYERS = ["domain", "application", "infrastructure", "presentation"];
const INNER_LAYERS = new Set(["domain", "application"]);

/** Last matching layer segment wins — mirrors the arch-linter's classifier. */
function layerOf(filePath: string): string | null {
  const segments = filePath.split("/");
  let layer: string | null = null;
  for (const segment of segments) {
    if (LAYERS.includes(segment)) layer = segment;
  }
  return layer;
}

/** Every module specifier a TS/JS source imports or re-exports. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    // import … from "x" / export … from "x" (multi-line tolerant)
    /(?:^|[\s;}])(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
    // bare side-effect import
    /(?:^|[\s;}])import\s*["']([^"']+)["']/g,
    // dynamic import
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    // CJS
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

/** Where a relative specifier lands, as a project-root-relative posix path. */
function resolveFrom(filePath: string, specifier: string): string {
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(filePath), specifier),
  );
}

/** Materialize every template on its own (its `requires` auto-resolve). */
async function materializeEveryTemplate(): Promise<Map<string, string>> {
  const materializer = createInMemoryMaterializer();
  const files = new Map<string, string>();
  for (const manifest of TEMPLATE_MANIFESTS) {
    const result = await materializer.materialize({ [manifest.id]: {} });
    assert.deepStrictEqual(
      result.errors,
      [],
      `template ${manifest.id} failed to materialize`,
    );
    for (const [rel, content] of result.files) {
      files.set(`${manifest.id}::${rel}`, content);
    }
  }
  return files;
}

/** One materialization pass shared by every assertion in this suite. */
let emitted: Promise<Map<string, string>>;
function allFiles(): Promise<Map<string, string>> {
  emitted ??= materializeEveryTemplate();
  return emitted;
}

const INFRA_IMPORT_HINT =
  "ADR-0053 §3: a domain/application file may not import from infrastructure/ (type-only included)";

describe("emitted templates — ports own their failure channel (ADR-0053)", () => {
  it("materializes at least the fourteen port-bearing templates", async () => {
    const files = await allFiles();
    const ports = [...files.keys()].filter((key) =>
      key.includes("/domain/ports/out/"),
    );
    // Guard against the walk silently emitting nothing (a stub materializer
    // returning zero files would otherwise satisfy every assertion below).
    assert.ok(
      ports.length >= 14,
      `expected >= 14 emitted out-ports, saw ${ports.length}`,
    );
  });

  it("no emitted domain/application file imports infrastructure/", async () => {
    const files = await allFiles();
    const violations: string[] = [];

    for (const [key, content] of files) {
      const [, filePath] = key.split("::");
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(filePath)) continue;
      const sourceLayer = layerOf(filePath);
      if (!sourceLayer || !INNER_LAYERS.has(sourceLayer)) continue;

      for (const specifier of importSpecifiers(content)) {
        const target = isRelative(specifier)
          ? layerOf(resolveFrom(filePath, specifier))
          : layerOf(specifier);
        if (target === "infrastructure" || target === "presentation") {
          violations.push(`${key} → ${specifier}`);
        }
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `${INFRA_IMPORT_HINT}\n${violations.join("\n")}`,
    );
  });

  it("resolves every import of a relocated module against the same install", async () => {
    // Templates are never compiled in this repo (the generated project compiles
    // them), so a wrong relative path to a moved module is invisible to
    // typecheck. This resolves every specifier naming one of the modules
    // ADR-0053 introduces or moves against the template's own install set — the
    // template plus everything its `requires` pulls in.
    const RELOCATED =
      /(creative-service-error|to-creative-service-error|errors\/llm-error|agent-runtime\.port)/;
    const materializer = createInMemoryMaterializer();
    const unresolved: string[] = [];
    let checked = 0;

    for (const manifest of TEMPLATE_MANIFESTS) {
      const result = await materializer.materialize({ [manifest.id]: {} });
      const present = new Set(result.files.keys());
      for (const [filePath, content] of result.files) {
        if (!/\.(ts|tsx)$/.test(filePath)) continue;
        for (const specifier of importSpecifiers(content)) {
          if (!isRelative(specifier) || !RELOCATED.test(specifier)) continue;
          checked += 1;
          const base = resolveFrom(filePath, specifier);
          if (!present.has(`${base}.ts`)) {
            unresolved.push(`${manifest.id}::${filePath} → ${specifier}`);
          }
        }
      }
    }

    assert.deepStrictEqual(
      unresolved,
      [],
      `imports resolving to nothing in the emitted install:\n${unresolved.join("\n")}`,
    );
    // Anti-stub: a materializer emitting nothing would also report zero misses.
    assert.ok(checked >= 30, `expected >= 30 such imports, saw ${checked}`);
  });

  it("keeps the domain failure unions free of any dependency", async () => {
    const files = await allFiles();
    const unions = [...files.entries()].filter(([key]) =>
      /::src\/domain\/errors\/(creative-service-error|llm-error)\.ts$/.test(
        key,
      ),
    );
    assert.ok(unions.length >= 2, "expected both domain error unions to emit");

    for (const [key, content] of unions) {
      assert.ok(
        !/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']/m.test(content),
        `${key}: a domain failure union must not import or re-export anything — ` +
          "re-exporting the vendor error would relocate the dependency, not remove it",
      );
      // Provider-neutrality, mechanically: a union naming a vendor could only
      // ever be satisfied by that vendor's adapter.
      assert.ok(
        !/\b(Firefly|Adobe|OpenAI|Anthropic|Bedrock|Azure)\b/i.test(content),
        `${key}: the union must name no vendor`,
      );
    }
  });

  it("maps the vendor error at the adapter boundary, never through the port", async () => {
    const files = await allFiles();
    const adapters = [...files.entries()].filter(
      ([key, content]) =>
        /::src\/infrastructure\//.test(key) &&
        /Result<[^>]*CreativeServiceError>/.test(content),
    );
    // 13 Adobe service adapters carry the union; one per service template.
    const distinct = new Set(adapters.map(([key]) => key.split("::")[1]));
    assert.ok(
      distinct.size >= 13,
      `expected >= 13 adapters on the domain union, saw ${distinct.size}`,
    );

    for (const [key, content] of adapters) {
      assert.ok(
        content.includes("toCreativeServiceError("),
        `${key}: must convert the vendor error at the boundary`,
      );
      assert.ok(
        !/\berr\(\s*classifyAdobeError\(/.test(content),
        `${key}: must not return the raw vendor classification into the Result`,
      );
      assert.ok(
        !/Result<[^>]*\bFireflyError\b/.test(content),
        `${key}: the vendor class must not appear in a port-typed Result`,
      );
    }
  });

  it("declares AgentRuntimePort outside the infrastructure layer", async () => {
    const files = await allFiles();
    // Deduplicated by emitted path: one template declares the port, but every
    // template that `requires` it re-emits the same file.
    const declaredAt = new Set(
      [...files.entries()]
        .filter(
          ([key, content]) =>
            /\.(ts|tsx)$/.test(key) &&
            /\binterface\s+AgentRuntimePort\b/.test(content),
        )
        .map(([key]) => key.split("::")[1]),
    );

    assert.equal(
      declaredAt.size,
      1,
      `expected exactly one AgentRuntimePort declaration site, saw ${[...declaredAt].join(", ")}`,
    );
    const [filePath] = [...declaredAt];
    const layer = layerOf(filePath);
    assert.ok(
      layer !== null && INNER_LAYERS.has(layer),
      `ADR-0053 §2: AgentRuntimePort must be emitted under domain/ or application/, found at ${filePath}`,
    );
  });
});
