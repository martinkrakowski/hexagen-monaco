import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isManifestDialect,
  mapManifestDialect,
} from "../../../src/domain/utils/manifest-dialect";
import { parseStructuredConfig } from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

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
});
