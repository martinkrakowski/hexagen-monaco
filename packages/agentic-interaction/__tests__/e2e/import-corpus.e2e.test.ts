import { describe, it, beforeAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { ManifestSchema } from "@hexagen/project-configuration";
import {
  parseStructuredConfig,
  buildNormalizedPromptFromConfig,
  buildDomainAnalysisFromConfig,
  buildClassificationFromConfig,
  buildContextMappingsFromConfig,
  buildPreDefinedPortMap,
  buildPreDefinedAdapterBindings,
  StructuredConfigShapeError,
} from "../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import { ExecuteManifestAssemblyUseCase } from "../../src/application/use-cases/staged-generation/execute-manifest-assembly.use-case";

/**
 * Import corpus harness (import-hardening plan §5 P2, gap G2).
 *
 * The structural reason import failures RECURRED across projects: nothing fed
 * representative import files through the pipeline and asserted the result.
 * This harness runs every supported input format through the DETERMINISTIC
 * import chain (parse → normalize → classify → pre-defined ports/adapters →
 * Stage-5 assembly) with no LLM involvement, and asserts two invariants:
 *
 *   1. ROUTING — files that must import deterministically do; files that must
 *      be rejected at this seam (so the UI routes them to the LLM/description
 *      paths) are.
 *   2. ACCEPT-PARSEABILITY — the assembled manifest passes the SAME strict
 *      ManifestSchema the accept screen parses with. A manifest that
 *      generates but can't be accepted is the failure mode that cost the
 *      alvaro-ai production run.
 *
 * Plus per-fixture content-preservation expectations (contexts, declared
 * ports/adapters) so a silently-lossy import can't pass.
 *
 * Add a fixture here whenever a new input shape is supported or a production
 * import fails — the corpus is the regression net. (LLM-derived garbage
 * FIELDS inside an otherwise-valid config are covered by the Stage-5 schema
 * gate's own tests — enforce-manifest-schema — not duplicated here.)
 */

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../use-cases/staged-generation/fixtures",
);
const read = (name: string) =>
  fs.readFileSync(path.join(fixturesDir, name), "utf8");

interface DeterministicCase {
  /** Fixture filename under staged-generation/fixtures/. */
  file: string;
  /** What the fixture represents (test title). */
  format: string;
  /** Exact bounded-context count the import must preserve. */
  contexts: number;
  /** Context names that MUST be present (subset check). */
  contextNames?: string[];
  /** Minimum pre-defined (declared-in-file) ports across all contexts. */
  minPredefinedPorts?: number;
  /** Minimum pre-defined adapters across all contexts. */
  minPredefinedAdapters?: number;
  /** Expected project identifier, when the format carries one. */
  project?: string;
}

const DETERMINISTIC_CORPUS: DeterministicCase[] = [
  {
    file: "krakowski-portal.yaml",
    format: "canonical YAML (bounded_contexts)",
    contexts: 7,
  },
  {
    file: "krakowski-portal.json",
    format: "canonical JSON",
    contexts: 7,
  },
  {
    file: "krakowski-portal-with-worker.yaml",
    format: "canonical YAML with apps",
    contexts: 8,
  },
  {
    file: "campaignforge-dialect.yaml",
    format:
      "rich hexagonal dialect (domain_models / primary_use_cases / ports)",
    contexts: 4,
    minPredefinedPorts: 1,
  },
  {
    file: "alvaro-manifest-dialect.yaml",
    format: "Hexagen manifest dialect (contexts: + top-level ports/adapters)",
    contexts: 9,
    contextNames: ["ImageDomain", "JobDomain", "WebUI", "Types", "Config"],
    minPredefinedPorts: 3,
    minPredefinedAdapters: 5,
    project: "alvaro-ai",
  },
  {
    file: "corpus-multi-doc.yaml",
    format: "multi-document YAML (--- separators)",
    contexts: 2,
    contextNames: ["Orders", "Billing"],
    project: "docsplit",
  },
  {
    file: "corpus-pseudo-yaml-signatures.yaml",
    format: "pseudo-YAML with TypeScript signatures (sanitizer recovery)",
    contexts: 1,
    contextNames: ["Orders"],
    minPredefinedPorts: 2,
    project: "sigspec",
  },
];

/** The deterministic import chain, exactly as the pipeline composes it before
 * any LLM stage runs. Returns the assembled manifest. */
function runDeterministicImport(raw: string) {
  const config = parseStructuredConfig(raw);
  const stage0 = buildNormalizedPromptFromConfig(config);
  const stage1 = buildDomainAnalysisFromConfig(config);
  const stage2 = buildClassificationFromConfig(config, stage1);
  const portMap = buildPreDefinedPortMap(config);
  const adapterBindings = buildPreDefinedAdapterBindings(config, portMap);
  const contextMappings = buildContextMappingsFromConfig(config);
  const assembled = new ExecuteManifestAssemblyUseCase().execute({
    stage0,
    stage1,
    stage2,
    stage3: portMap,
    stage4: adapterBindings,
    contextMappings,
    apps: config.apps ?? [],
  });
  return { config, portMap, adapterBindings, assembled };
}

describe("import corpus — deterministic formats", () => {
  for (const c of DETERMINISTIC_CORPUS) {
    describe(`${c.format} [${c.file}]`, () => {
      // Compute inside beforeAll, NOT at describe-definition time: a fixture
      // that fails to read/parse must surface as a failing test, not throw
      // during suite collection (which would deregister every it() below and
      // erase the granularity — qodo #410).
      let config: ReturnType<typeof runDeterministicImport>["config"];
      let portMap: ReturnType<typeof runDeterministicImport>["portMap"];
      let adapterBindings: ReturnType<
        typeof runDeterministicImport
      >["adapterBindings"];
      let assembled: ReturnType<typeof runDeterministicImport>["assembled"];
      beforeAll(() => {
        ({ config, portMap, adapterBindings, assembled } =
          runDeterministicImport(read(c.file)));
      });

      it("imports without the LLM and preserves the contexts", () => {
        assert.equal(config.bounded_contexts.length, c.contexts);
        if (c.contextNames) {
          const names = new Set(config.bounded_contexts.map((x) => x.name));
          for (const required of c.contextNames) {
            assert.ok(names.has(required), `missing context ${required}`);
          }
        }
        if (c.project) assert.equal(config.project, c.project);
      });

      it("preserves the file's declared ports and adapters", () => {
        const portCount = portMap.contexts.reduce(
          (sum, ctx) => sum + ctx.in.length + ctx.out.length,
          0,
        );
        const adapterCount = adapterBindings.contexts.reduce(
          (sum, ctx) => sum + ctx.adapters.length,
          0,
        );
        assert.ok(
          portCount >= (c.minPredefinedPorts ?? 0),
          `expected ≥${c.minPredefinedPorts ?? 0} pre-defined ports, got ${portCount}`,
        );
        assert.ok(
          adapterCount >= (c.minPredefinedAdapters ?? 0),
          `expected ≥${c.minPredefinedAdapters ?? 0} pre-defined adapters, got ${adapterCount}`,
        );
      });

      it("assembles a manifest the accept screen will parse", () => {
        // The exact strict schema parseManifestToWizardData uses — the
        // invariant whose absence bricked the alvaro-ai run.
        const result = ManifestSchema.safeParse(yaml.load(assembled.yaml));
        assert.ok(result.success, result.success ? "" : result.error.message);
      });
    });
  }
});

describe("import corpus — rejected at the deterministic seam", () => {
  it("prose/markdown is rejected (routes to the LLM conversion by design)", () => {
    assert.throws(() => parseStructuredConfig(read("corpus-prose.md")));
  });

  it("the loose-spec markdown fixture is rejected (it is LLM-conversion INPUT)", () => {
    assert.throws(() =>
      parseStructuredConfig(read("krakowski-portal-loose.md")),
    );
  });

  it("all-nameless contexts fail fast with a shape error, not a mid-pipeline crash (G4)", () => {
    assert.throws(
      () => parseStructuredConfig(read("corpus-nameless-contexts.yaml")),
      StructuredConfigShapeError,
    );
  });

  it("empty input is rejected", () => {
    assert.throws(() => parseStructuredConfig(""));
  });
});

describe("import corpus — partial garbage inside a valid file", () => {
  it("drops nameless context entries but keeps the named ones (G4)", () => {
    const config = parseStructuredConfig(
      JSON.stringify({
        bounded_contexts: [
          { name: "Orders", responsibility: "Orders" },
          { responsibility: "nameless — dropped" },
          null,
        ],
      }),
    );
    assert.deepEqual(
      config.bounded_contexts.map((c) => c.name),
      ["Orders"],
    );
  });
});
