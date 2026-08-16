/**
 * Item 6.2 / HEX-034 — the LLM governance-context route stops doing workspace
 * discovery and manifest merging itself. It reads the merged manifest through
 * the composition root and projects it with one pure function.
 *
 * The suite pins that by feeding a manifest that CANNOT come from disk: if the
 * route still walked up from `process.cwd()` and merged this repo's own
 * `.architecture/manifest.yaml`, the payload would carry this repo's contexts
 * instead of the fixture's.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Manifest } from "@hexagen/project-configuration";

const wire = vi.hoisted(() => ({
  getMergedManifest: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../../../lib/wire.server", () => ({
  getMergedManifestProvider: () => ({
    getMergedManifest: wire.getMergedManifest,
  }),
}));

const FIXTURE = {
  system: "fixture-system",
  scope: "fixture-scope",
  architecture: "hexagonal",
  bounded_contexts: [
    {
      name: "billing",
      type: "core",
      layers: {
        application: {
          ports: {
            in: ["ChargeCardPort"],
            out: [{ name: "PaymentGatewayPort" }],
          },
        },
      },
    },
    {
      name: "shipping",
      // No `type` — the projection defaults it to "supporting".
      layers: { application: { ports: { out: ["CarrierPort"] } } },
    },
  ],
} as unknown as Manifest;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("projects the manifest the composition root returned, not one read off disk", async () => {
  wire.getMergedManifest.mockResolvedValue(FIXTURE);
  const { GET } = await import("../route");

  const res = await GET();
  expect(res.status).toBe(200);
  // The cache header is part of the route's observable contract, and it is
  // asymmetric with the degraded path below on purpose.
  expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  const payload = await res.json();

  expect(payload.system).toBe("fixture-system");
  expect(payload.scope).toBe("fixture-scope");
  expect(payload.architecture).toBe("hexagonal");
  expect(payload.boundedContexts).toEqual([
    { name: "billing", type: "core" },
    { name: "shipping", type: "supporting" },
  ]);
  // Port ownership covers in- and out-ports, and unwraps the object form.
  expect(payload.ports).toEqual({
    ChargeCardPort: "billing",
    PaymentGatewayPort: "billing",
    CarrierPort: "shipping",
  });
  expect(payload.invariants.map((i: { name: string }) => i.name)).toContain(
    "port-single-ownership",
  );
});

test("bounded-context types follow the canonical vocabulary, not a hand-written subset", async () => {
  // `generic` is a canonical BOUNDED_CONTEXT_TYPES value that `mergeSplitManifest`
  // accepts, so it must reach the assistant verbatim — collapsing it to
  // "supporting" would tell the model the wrong thing about the architecture.
  // `nonsense` never survives the loader's enum; the projection still refuses to
  // emit it, because callers can hand it a manifest the loader never saw.
  wire.getMergedManifest.mockResolvedValue({
    system: "s",
    bounded_contexts: [
      { name: "reporting", type: "generic" },
      { name: "junk", type: "nonsense" },
      { name: "unspecified" },
    ],
  } as unknown as Manifest);
  const { GET } = await import("../route");

  const payload = await (await GET()).json();
  expect(payload.boundedContexts).toEqual([
    { name: "reporting", type: "generic" },
    { name: "junk", type: "supporting" },
    { name: "unspecified", type: "supporting" },
  ]);
});

test("an unavailable manifest degrades to the empty payload with 200", async () => {
  wire.getMergedManifest.mockResolvedValue(null);
  const { GET } = await import("../route");

  const res = await GET();
  expect(res.status).toBe(200);
  // A degraded payload must NOT inherit the hour-long cache: a shared cache
  // would pin the empty context for an hour past the manifest coming back.
  expect(res.headers.get("cache-control")).not.toBe("public, max-age=3600");
  const payload = await res.json();
  expect(payload.system).toBe("");
  expect(payload.boundedContexts).toEqual([]);
  expect(payload.ports).toEqual({});
});

test("a provider that throws is a 500, not a silently-empty payload", async () => {
  wire.getMergedManifest.mockRejectedValue(new Error("disk on fire"));
  const { GET } = await import("../route");

  const res = await GET();
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Internal Server Error" });
});
