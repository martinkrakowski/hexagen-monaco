import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isManifestDialect,
  mapManifestDialect,
} from "../../../src/domain/utils/manifest-dialect";
import {
  parseStructuredConfig,
  buildPreDefinedPortMap,
  buildPreDefinedAdapterBindings,
  structuralManifestErrors,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/alvaro-manifest-dialect.yaml",
);
const alvaroYaml = fs.readFileSync(fixturePath, "utf8");

/**
 * Deterministic import of the Hexagen manifest dialect (`contexts:` +
 * top-level `ports:`/`adapters:`/`planes:`). Before mapManifestDialect these
 * files failed the shape check and detoured through the LLM loose-spec
 * conversion — nondeterministic and lossy (the alvaro-ai production run
 * discarded every declared port, adapter, and plane). The fixture is the
 * actual file from that run.
 */
describe("isManifestDialect", () => {
  it("recognizes a contexts: file and rejects canonical/garbage shapes", () => {
    assert.equal(isManifestDialect({ contexts: [{ name: "A" }] }), true);
    // Canonical shape wins even when both keys exist.
    assert.equal(
      isManifestDialect({
        contexts: [{ name: "A" }],
        bounded_contexts: [{ name: "B" }],
      }),
      false,
    );
    assert.equal(
      isManifestDialect({ bounded_contexts: [{ name: "A" }] }),
      false,
    );
    // Nameless / non-object context entries don't qualify.
    assert.equal(
      isManifestDialect({ contexts: ["A", { plane: "Core" }] }),
      false,
    );
    assert.equal(isManifestDialect(null), false);
    assert.equal(isManifestDialect([]), false);
    assert.equal(isManifestDialect("contexts:"), false);
  });
});

describe("mapManifestDialect", () => {
  it("passes canonical configs through unchanged (same reference)", () => {
    const canonical = { bounded_contexts: [{ name: "Orders" }] };
    assert.equal(mapManifestDialect(canonical), canonical);
  });

  it("does not mutate the input document", () => {
    const input = {
      name: "proj",
      contexts: [{ name: "A", path: "packages/a" }],
      ports: [{ name: "APort", path: "packages/a/src/ports/a.port.ts" }],
      adapters: [],
    };
    const before = JSON.stringify(input);
    mapManifestDialect(input);
    assert.equal(JSON.stringify(input), before);
  });

  it("assigns ports to owners by longest path-prefix match", () => {
    const mapped = mapManifestDialect({
      contexts: [
        { name: "Outer", path: "packages/core" },
        { name: "Inner", path: "packages/core/image-domain" },
      ],
      ports: [
        {
          name: "UpscalePort",
          path: "packages/core/image-domain/src/ports/upscale.port.ts",
        },
        { name: "SharedPort", path: "packages/core/src/ports/shared.port.ts" },
        { name: "OrphanPort", path: "packages/elsewhere/orphan.port.ts" },
      ],
    }) as { bounded_contexts: Array<Record<string, unknown>> };

    const portsOf = (name: string) =>
      (
        mapped.bounded_contexts.find((c) => c.name === name) as {
          layers?: {
            application?: { ports?: { in?: string[]; out?: string[] } };
          };
        }
      ).layers?.application?.ports;
    assert.deepEqual(portsOf("Inner")?.out, ["UpscalePort"]);
    assert.deepEqual(portsOf("Outer")?.out, ["SharedPort"]);
    // The orphan is NOT guessed onto any context...
    assert.equal(portsOf("Inner")?.out?.includes("OrphanPort"), false);
    assert.equal(portsOf("Outer")?.out?.includes("OrphanPort"), false);
    // ...but it is preserved under top-level `ports:`, never silently dropped.
    const topPorts = (mapped as { ports?: Array<{ name: string }> }).ports;
    assert.deepEqual(
      topPorts?.map((p) => p.name),
      ["OrphanPort"],
    );
  });

  it("preserves ports with no path and adapters with an unmatched context", () => {
    const mapped = mapManifestDialect({
      contexts: [{ name: "A", path: "packages/a" }],
      ports: [
        { name: "MatchedPort", path: "packages/a/p.ts" },
        { name: "PathlessPort" }, // no path → can't be owned
      ],
      adapters: [
        { name: "GoodAdapter", context: "A" },
        { name: "OrphanAdapter", context: "DoesNotExist" },
        { name: "ContextlessAdapter" }, // no context
      ],
    }) as {
      bounded_contexts: Array<Record<string, unknown>>;
      ports?: Array<{ name: string }>;
      adapters?: Array<{ name: string }>;
    };
    const ctxA = mapped.bounded_contexts[0] as {
      layers?: {
        application?: { ports?: { out?: string[] } };
        infrastructure?: { adapters?: string[] };
      };
    };
    assert.deepEqual(ctxA.layers?.application?.ports?.out, ["MatchedPort"]);
    assert.deepEqual(ctxA.layers?.infrastructure?.adapters, ["GoodAdapter"]);
    // Unassignable declarations survive at the top level for the user to fix.
    assert.deepEqual(
      mapped.ports?.map((p) => p.name),
      ["PathlessPort"],
    );
    assert.deepEqual(
      mapped.adapters?.map((a) => a.name),
      ["OrphanAdapter", "ContextlessAdapter"],
    );
  });

  it("removes the top-level blocks entirely when everything is assigned", () => {
    const mapped = mapManifestDialect({
      contexts: [{ name: "A", path: "packages/a" }],
      ports: [{ name: "P", path: "packages/a/p.ts" }],
      adapters: [{ name: "AAdapter", context: "A" }],
    }) as Record<string, unknown>;
    assert.equal("ports" in mapped, false);
    assert.equal("adapters" in mapped, false);
  });

  it("routes command/query-named unimplemented ports inbound, implemented ports outbound", () => {
    const mapped = mapManifestDialect({
      contexts: [{ name: "A", path: "packages/a" }],
      ports: [
        { name: "PlaceOrderCommandPort", path: "packages/a/p1.ts" },
        { name: "StoragePort", path: "packages/a/p2.ts" },
      ],
      adapters: [
        { name: "FsAdapter", implements: "StoragePort", context: "A" },
      ],
    }) as { bounded_contexts: Array<Record<string, unknown>> };
    const layers = mapped.bounded_contexts[0].layers as {
      application?: { ports?: { in?: string[]; out?: string[] } };
    };
    assert.deepEqual(layers.application?.ports?.in, ["PlaceOrderCommandPort"]);
    assert.deepEqual(layers.application?.ports?.out, ["StoragePort"]);
  });
});

describe("parseStructuredConfig — alvaro manifest fixture (end to end)", () => {
  const config = parseStructuredConfig(alvaroYaml);

  it("imports all 9 contexts deterministically with the project name", () => {
    assert.equal(config.bounded_contexts.length, 9);
    assert.equal(config.project, "alvaro-ai");
  });

  it("assigns the declared ports to their path-owning core contexts", () => {
    const byName = (name: string) =>
      config.bounded_contexts.find((c) => c.name === name);
    // UpscalePort + StoragePort live under packages/core/image-domain.
    assert.deepEqual(
      byName("ImageDomain")?.layers?.application?.ports?.out?.sort(),
      ["StoragePort", "UpscalePort"],
    );
    assert.deepEqual(byName("JobDomain")?.layers?.application?.ports?.out, [
      "JobQueuePort",
    ]);
  });

  it("assigns the declared adapters to their declared contexts", () => {
    const adaptersOf = (name: string) =>
      config.bounded_contexts.find((c) => c.name === name)?.layers
        ?.infrastructure?.adapters;
    assert.deepEqual(adaptersOf("RealESRGANAdapter"), [
      "RealESRGANAdapter",
      "MockUpscaleAdapter",
    ]);
    assert.deepEqual(adaptersOf("FileSystemAdapter"), [
      "LocalFileSystemAdapter",
    ]);
    assert.deepEqual(adaptersOf("QueueAdapter"), ["InMemoryQueueAdapter"]);
    assert.deepEqual(adaptersOf("ZipAdapter"), ["StreamingZipAdapter"]);
  });

  it("maps the SharedKernel plane casing onto type shared-kernel", () => {
    for (const name of ["Types", "Config"]) {
      assert.equal(
        config.bounded_contexts.find((c) => c.name === name)?.type,
        "shared-kernel",
        name,
      );
    }
  });

  it("joins responsibilities into the canonical responsibility string", () => {
    const image = config.bounded_contexts.find((c) => c.name === "ImageDomain");
    assert.ok(image?.responsibility?.includes("job state machine"));
  });

  // ── Provenance carried through the mapper (alvaro-ai RCA) ────────────────
  // Dropping the author's `implements`/descriptions forced same-context name
  // re-inference downstream, which left all five adapters unbound: 5 phantom
  // R06 ('UnnamedPort'), 11 real R14, and trivial-description R16s against the
  // author's own input.

  const ctxOf = (name: string) =>
    config.bounded_contexts.find((c) => c.name === name);

  it("carries each adapter's declared implements in the sidecar", () => {
    assert.deepEqual(
      ctxOf("RealESRGANAdapter")?.layers?.infrastructure?.adapter_implements,
      { RealESRGANAdapter: "UpscalePort", MockUpscaleAdapter: "UpscalePort" },
    );
    assert.deepEqual(
      ctxOf("FileSystemAdapter")?.layers?.infrastructure?.adapter_implements,
      { LocalFileSystemAdapter: "StoragePort" },
    );
    assert.deepEqual(
      ctxOf("ZipAdapter")?.layers?.infrastructure?.adapter_implements,
      { StreamingZipAdapter: "StoragePort" },
    );
  });

  it("seeds a cross-context implemented port into the implementing context's out slot", () => {
    // StoragePort is owned by ImageDomain (path) but implemented from
    // FileSystemAdapter AND ZipAdapter — the #402 single-ownership shape.
    assert.deepEqual(
      ctxOf("FileSystemAdapter")?.layers?.application?.ports?.out,
      ["StoragePort"],
    );
    assert.deepEqual(ctxOf("ZipAdapter")?.layers?.application?.ports?.out, [
      "StoragePort",
    ]);
    assert.deepEqual(ctxOf("QueueAdapter")?.layers?.application?.ports?.out, [
      "JobQueuePort",
    ]);
    // The owning context keeps it too — the duplicate is the #402 advisory's
    // designed trigger, not a bug.
    assert.ok(
      ctxOf("ImageDomain")?.layers?.application?.ports?.out?.includes(
        "StoragePort",
      ),
    );
  });

  it("carries author port descriptions to the owner AND to seeded contexts", () => {
    assert.equal(
      ctxOf("ImageDomain")?.layers?.application?.port_descriptions?.[
        "UpscalePort"
      ],
      "Primary port for performing super-resolution.",
    );
    assert.equal(
      ctxOf("FileSystemAdapter")?.layers?.application?.port_descriptions?.[
        "StoragePort"
      ],
      "Abstract file and workspace operations.",
    );
  });

  it("binds declared adapters through the pre-defined chain, keep-first on multi-implementers", () => {
    // The full deterministic chain the orchestrator runs for pre-defined
    // contexts: port map from the mapped config, then bindings. Before the fix
    // all five adapters came out with implements: "" (nothing to infer against
    // in their own contexts) and the judge was shown 'UnnamedPort'.
    const advisories: string[] = [];
    const portMap = buildPreDefinedPortMap(config);
    const bindings = buildPreDefinedAdapterBindings(config, portMap, (m) =>
      advisories.push(m),
    );
    const bindingOf = (adapterName: string) => {
      for (const ctx of bindings.contexts) {
        const hit = ctx.adapters.find((a) => a.name === adapterName);
        if (hit) return hit.implements;
      }
      return undefined;
    };
    assert.equal(bindingOf("RealESRGANAdapter"), "UpscalePort");
    // Prod + mock both declare UpscalePort; R04 allows exactly one adapter per
    // port, so the FIRST declared implementer wins and the mock stays in the
    // manifest unbound — disclosed, not an error.
    assert.equal(bindingOf("MockUpscaleAdapter"), "");
    assert.equal(advisories.length, 1);
    assert.match(advisories[0], /UpscalePort.*MockUpscaleAdapter/s);
    assert.equal(bindingOf("LocalFileSystemAdapter"), "StoragePort");
    assert.equal(bindingOf("InMemoryQueueAdapter"), "JobQueuePort");
    assert.equal(bindingOf("StreamingZipAdapter"), "StoragePort");
  });

  it("declared bindings claim ports before inference, regardless of adapter order (PR #411 CR)", () => {
    // An UNDECLARED adapter whose name infers into a port that a LATER adapter
    // explicitly declares must not steal the port: declared claims run first
    // (two-pass), and the inferred binding goes unbound with an advisory.
    const doc = [
      "name: precedence",
      "contexts:",
      "  - name: Engine",
      "    path: packages/engine",
      "ports:",
      "  - name: UpscalePort",
      "    path: packages/engine/src/upscale.port.ts",
      "adapters:",
      "  - name: UpscaleHelperAdapter", // no implements — infers UpscalePort by containment
      "    context: Engine",
      "  - name: RealAdapter",
      "    implements: UpscalePort", // declared, listed AFTER the inferring one
      "    context: Engine",
      "",
    ].join("\n");
    const parsed = parseStructuredConfig(doc);
    const advisories: string[] = [];
    const portMap = buildPreDefinedPortMap(parsed);
    const bindings = buildPreDefinedAdapterBindings(parsed, portMap, (m) =>
      advisories.push(m),
    );
    const all = bindings.contexts.flatMap((c) => c.adapters);
    assert.equal(
      all.find((a) => a.name === "RealAdapter")?.implements,
      "UpscalePort",
      "declared binding wins the port",
    );
    assert.equal(
      all.find((a) => a.name === "UpscaleHelperAdapter")?.implements,
      "",
      "inferred binding yields to the declared claim",
    );
    assert.equal(advisories.length, 1);
    assert.match(advisories[0], /name-inferred/);
  });

  it("a duplicate adapter name still records its binding and seeds its port (PR #411 CR)", () => {
    // A context whose inline layers pre-declare the adapter NAME, with the
    // top-level adapters block carrying the binding: the name must not append
    // twice, but the sidecar + cross-context seeding must still run.
    const doc = [
      "name: dupe",
      "contexts:",
      "  - name: Core",
      "    path: packages/core",
      "  - name: Infra",
      "    path: packages/infra",
      "    layers:",
      "      infrastructure:",
      "        adapters: [StoreAdapter]",
      "ports:",
      "  - name: StorePort",
      "    path: packages/core/src/store.port.ts",
      "adapters:",
      "  - name: StoreAdapter",
      "    implements: StorePort",
      "    context: Infra",
      "",
    ].join("\n");
    const parsed = parseStructuredConfig(doc);
    const infra = parsed.bounded_contexts.find((c) => c.name === "Infra");
    assert.deepEqual(infra?.layers?.infrastructure?.adapters, ["StoreAdapter"]);
    assert.deepEqual(infra?.layers?.infrastructure?.adapter_implements, {
      StoreAdapter: "StorePort",
    });
    assert.deepEqual(infra?.layers?.application?.ports?.out, ["StorePort"]);
  });

  it("declared bindings introduce no duplicate-R04 and no R06 at the deterministic gate (e2e pin)", () => {
    // Pins the class of error this change could INTRODUCE: honoring the
    // author's bindings must not trade the old phantom R06s for a true-by-rule
    // multi-implementer R04 on the prod+mock pair (keep-first resolves it).
    // Zero-adapter R04s/R02s/R03s are expected at this point in the chain —
    // Stage 4's LLM and the R02/R03 synthesizers fill those before the real
    // gate runs; this test exercises only the pre-defined structures.
    const portMap = buildPreDefinedPortMap(config);
    const bindings = buildPreDefinedAdapterBindings(config, portMap, () => {});
    const parsed = {
      system: "alvaro",
      scope: "@alvaro",
      bounded_contexts: config.bounded_contexts,
    } as unknown as Record<string, unknown>;
    const errors = structuralManifestErrors(portMap, bindings, parsed);
    assert.ok(
      !errors.some((e) => /^\[R04\].*has [2-9]\d* adapters/.test(e)),
      `no multi-implementer R04, got: ${errors.join(" | ")}`,
    );
    assert.ok(
      !errors.some((e) => e.startsWith("[R06]")),
      `no R06, got: ${errors.join(" | ")}`,
    );
  });

  it("uses the author's port description in the pre-defined port map (no trivial R16 stub)", () => {
    const portMap = buildPreDefinedPortMap(config);
    const image = portMap.contexts.find((c) => c.contextName === "ImageDomain");
    const upscale = image?.out.find((p) => p.name === "UpscalePort");
    assert.equal(
      upscale?.description,
      "Primary port for performing super-resolution.",
    );
  });
});
