import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { mergeSplitManifest } from "../../../src/infrastructure/adapters/manifest-merge-loader.js";
import {
  ManifestSchema,
  IndexManifestSchema,
} from "../../../src/domain/model/manifest-schema/manifest-schema.js";
import type { Manifest } from "../../../src/domain/model/manifest-schema/manifest-schema.js";

const FIELDS_EXTRACTED_TO_WORKSPACE_CONFIG = ["monorepo", "generator"] as const;

// NOTE: flattenStringArray and normalizeContextData are duplicated from
// packages/sync/src/commands/manifest/split-utils.ts to maintain test
// independence. If these utilities grow, extract to a shared module.

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  TEST_DIR,
  "..",
  "..",
  "__fixtures__",
  "manifest.monolithic.yaml",
);

type RawRecord = Record<string, unknown>;

function buildPlaneLookup(
  planes: Record<string, string[]> | undefined,
  contexts: RawRecord[],
): Map<string, string> {
  const lookup = new Map<string, string>();
  if (planes) {
    for (const [plane, names] of Object.entries(planes)) {
      for (const name of names) {
        lookup.set(name, plane);
      }
    }
  }
  const typeToPlane: Record<string, string> = {
    core: "core",
    supporting: "supporting",
    "shared-kernel": "shared-kernel",
    driver: "projection",
    generic: "supporting",
  };
  for (const ctx of contexts) {
    const name = ctx.name as string;
    if (!lookup.has(name) && typeof ctx.type === "string") {
      const plane = typeToPlane[ctx.type];
      if (plane) lookup.set(name, plane);
    }
  }
  return lookup;
}

function extractWorkspaceConfig(raw: RawRecord): RawRecord {
  const config: RawRecord = {};
  for (const key of FIELDS_EXTRACTED_TO_WORKSPACE_CONFIG) {
    if (key in raw) config[key] = raw[key];
  }
  return config;
}

function flattenStringArray(val: unknown): unknown[] {
  if (!Array.isArray(val)) return val as unknown[];
  const result: unknown[] = [];
  for (const item of val) {
    if (typeof item === "string") {
      result.push(item);
    } else if (Array.isArray(item)) {
      result.push(...flattenStringArray(item));
    }
  }
  return result;
}

function normalizeContextData(ctx: RawRecord): RawRecord {
  const out: RawRecord = { ...ctx };
  const layers = out.layers as RawRecord | undefined;
  if (layers) {
    const infra = layers.infrastructure as RawRecord | undefined;
    if (infra && Array.isArray(infra.adapters)) {
      layers.infrastructure = {
        ...infra,
        adapters: flattenStringArray(infra.adapters),
      };
    }
  }
  return out;
}

async function writeSplitFiles(
  tmpDir: string,
  raw: RawRecord,
  planeLookup: Map<string, string>,
): Promise<void> {
  const archDir = path.join(tmpDir, ".architecture");
  await fs.mkdir(archDir, { recursive: true });

  const contexts = (raw.bounded_contexts as RawRecord[]) ?? [];
  const apps = (raw.apps as Array<RawRecord | string>) ?? [];

  const indexContexts = contexts.map((ctx) => {
    const name = ctx.name as string;
    const plane = planeLookup.get(name);
    const entry: RawRecord = { name };
    if (typeof ctx.type === "string") entry.type = ctx.type;
    if (plane) entry.plane = plane;
    if (typeof ctx.status === "string") entry.status = ctx.status;
    entry.file = plane
      ? `contexts/${plane}/${name}/context.yaml`
      : `contexts/_unplaced/${name}/context.yaml`;
    return entry;
  });

  const indexApps = apps.map((app) => {
    const name = typeof app === "string" ? app : (app.name as string);
    return { name, file: `apps/${name}.app.yaml` };
  });

  const index: RawRecord = {
    version: "2.0",
    system: raw.system,
    scope: raw.scope,
    architecture: raw.architecture,
  };
  // IndexManifestSchema requires `description` — the split index is a real
  // manifest form. ALWAYS set it, with the same fallback the production
  // splitter uses (split.ts), so a future fixture that omits `description`
  // still produces a valid index rather than failing for a non-obvious reason.
  index.description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description
      : "Auto-generated manifest";
  if (raw.planes) index.planes = raw.planes;
  if (indexContexts.length > 0) index.bounded_contexts = indexContexts;
  if (indexApps.length > 0) index.apps = indexApps;
  if (raw.mvk) index.mvk = raw.mvk;
  index.workspace_config = "workspace.config.yaml";

  await fs.writeFile(
    path.join(archDir, "manifest.yaml"),
    yaml.dump(index, { lineWidth: -1, noRefs: true }),
    "utf-8",
  );

  const wsConfig = extractWorkspaceConfig(raw);
  await fs.writeFile(
    path.join(archDir, "workspace.config.yaml"),
    yaml.dump(wsConfig, { lineWidth: -1, noRefs: true }),
    "utf-8",
  );

  for (const ctx of contexts) {
    const name = ctx.name as string;
    const plane = planeLookup.get(name) ?? "_unplaced";
    const ctxDir = path.join(archDir, "contexts", plane, name);
    await fs.mkdir(ctxDir, { recursive: true });
    await fs.writeFile(
      path.join(ctxDir, "context.yaml"),
      yaml.dump(normalizeContextData(ctx), { lineWidth: -1, noRefs: true }),
      "utf-8",
    );
  }

  const appsDir = path.join(archDir, "apps");
  await fs.mkdir(appsDir, { recursive: true });
  for (const app of apps) {
    const appData: RawRecord =
      typeof app === "string" ? { name: app } : { ...app };
    const name = appData.name as string;
    await fs.writeFile(
      path.join(appsDir, `${name}.app.yaml`),
      yaml.dump(appData, { lineWidth: -1, noRefs: true }),
      "utf-8",
    );
  }
}

describe("Manifest Split Round-Trip", () => {
  let tmpDir: string | undefined;
  let rawManifest: RawRecord;
  let mergedManifest: Manifest;
  let rawWorkspaceConfig: RawRecord;
  let indexData: RawRecord;

  before(async () => {
    const rawContent = await fs.readFile(FIXTURE_PATH, "utf-8");
    rawManifest = yaml.load(rawContent) as RawRecord;

    const manifestResult = ManifestSchema.safeParse(rawManifest);
    assert.ok(
      manifestResult.success,
      "Fixture monolithic manifest must validate against ManifestSchema",
    );

    const planes = rawManifest.planes as Record<string, string[]> | undefined;
    const contexts = (rawManifest.bounded_contexts as RawRecord[]) ?? [];
    const planeLookup = buildPlaneLookup(planes, contexts);

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-roundtrip-"));
    await writeSplitFiles(tmpDir, rawManifest, planeLookup);

    const manifestPath = path.join(tmpDir, ".architecture", "manifest.yaml");
    mergedManifest = await mergeSplitManifest(tmpDir, manifestPath);

    const wsContent = await fs.readFile(
      path.join(tmpDir, ".architecture", "workspace.config.yaml"),
      "utf-8",
    );
    rawWorkspaceConfig = yaml.load(wsContent) as RawRecord;

    const indexContent = await fs.readFile(manifestPath, "utf-8");
    indexData = yaml.load(indexContent) as RawRecord;
  });

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves architectural governance fields after split-merge round-trip", () => {
    assert.strictEqual(mergedManifest.system, rawManifest.system);
    assert.strictEqual(mergedManifest.scope, rawManifest.scope);
    assert.strictEqual(mergedManifest.architecture, rawManifest.architecture);

    const originalContextNames = (
      (rawManifest.bounded_contexts as RawRecord[]) ?? []
    ).map((c) => c.name as string);
    const mergedContextNames = (mergedManifest.bounded_contexts ?? []).map(
      (c) => c.name,
    );
    assert.deepStrictEqual(mergedContextNames, originalContextNames);

    const originalAppNames = (
      (rawManifest.apps as Array<RawRecord | string>) ?? []
    ).map((a) => (typeof a === "string" ? a : (a.name as string)));
    const mergedAppNames = (mergedManifest.apps ?? []).map(
      (a) => (a as RawRecord).name as string,
    );
    assert.deepStrictEqual(mergedAppNames, originalAppNames);
  });

  it("enforces plane/path consistency in index manifest", () => {
    const indexResult = IndexManifestSchema.safeParse(indexData);
    assert.ok(
      indexResult.success,
      "Index manifest must validate against IndexManifestSchema",
    );

    const entries = indexResult.data.bounded_contexts ?? [];
    for (const entry of entries) {
      if (entry.plane && entry.file) {
        assert.ok(
          entry.file.startsWith(`contexts/${entry.plane}/`),
          `Context "${entry.name}" file "${entry.file}" must start with "contexts/${entry.plane}/"`,
        );
      }
    }
  });

  it("workspace.config.yaml contains workspace fields and no governance fields", () => {
    const wsKeys = Object.keys(rawWorkspaceConfig);

    assert.ok(
      wsKeys.includes("monorepo"),
      "workspace.config.yaml must contain 'monorepo'",
    );
    assert.ok(
      wsKeys.includes("generator"),
      "workspace.config.yaml must contain 'generator'",
    );

    const governanceKeys = [
      "bounded_contexts",
      "apps",
      "system",
      "scope",
      "architecture",
      "planes",
      "mvk",
    ];
    for (const key of governanceKeys) {
      assert.ok(
        !wsKeys.includes(key),
        `workspace.config.yaml must not contain governance key '${key}'`,
      );
    }
  });
});
