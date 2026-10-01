import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import type { ZodTypeAny } from "zod";
import {
  ObservedReport,
  Slice,
  Contract,
  ProposalMeta,
  BundleIndex,
  Tip,
  UNRESOLVED_IMPORT_RULE_ID,
} from "../../src/types/brownfield/index";

const HEX = "a".repeat(64);
const repo = { commit: "abc1234" };
const T = "2026-10-01T00:00:00.000Z";

const observed = {
  schemaVersion: "1.0.0",
  repo,
  generatedAt: T,
  packages: {
    collected: true,
    items: [
      {
        name: "@acme/Bill-ing",
        root: "libs/b",
        manifestFile: "libs/b/package.json",
      },
    ],
  },
  languages: { collected: true, items: [{ name: "ts", fileCount: 3 }] },
  build: {
    collected: true,
    items: [{ marker: "package.json", path: "package.json" }],
  },
  generated: {
    collected: true,
    items: [{ path: "dist/", source: "gitignored-build-dir" }],
  },
  dontTouch: { collected: true, items: [{ path: "vendor/", source: "flag" }] },
  edges: {
    collected: true,
    unreadLanguages: ["go"],
    items: [{ from: "a.ts", to: "libs/b", specifier: "@acme/Bill-ing" }],
  },
  unresolved: {
    collected: true,
    items: [{ from: "a.ts", specifier: "./nope", reason: "not found" }],
  },
  limits: { truncated: false, reasons: [] },
};

const slice = {
  schemaVersion: "1.0.0",
  id: "s1",
  repo,
  paths: ["packages/bill/", "README.md"],
  excludes: ["packages/bill/gen/"],
  createdBy: "fde",
  createdAt: T,
};

const contract = {
  schemaVersion: "1.0.0",
  sliceId: "s1",
  rules: [
    {
      id: "no-ui",
      kind: "forbid",
      from: "packages/bill/",
      to: "apps/ui/",
      severity: "error",
    },
    {
      id: "only-lib",
      kind: "allow-only",
      from: "packages/bill/",
      to: "libs/",
      severity: "warn",
    },
    {
      id: UNRESOLVED_IMPORT_RULE_ID,
      kind: "forbid",
      from: "packages/bill/",
      to: "packages/bill/",
      severity: "error",
    },
  ],
  knownViolations: [
    {
      rule: UNRESOLVED_IMPORT_RULE_ID,
      file: "packages/bill/a.ts",
      specifier: "./x",
    },
  ],
};

const proposal = {
  id: "p1",
  grantId: "g1",
  sliceId: "s1",
  tool: "edit_file",
  paths: ["packages/bill/a.ts"],
  traceSeq: 4,
  createdAt: T,
};

const bundle = {
  schemaVersion: "1.0.0",
  createdAt: T,
  sliceId: "s1",
  files: [
    { path: ".hexagen/slice.json", role: "slice", sha256: HEX },
    { path: ".hexagen/evidence/trace.jsonl", role: "evidence", sha256: HEX },
  ],
  hmac: HEX,
};

const tip = { seq: 3, hash: HEX, hmac: HEX };

const kernel = path.resolve(__dirname, "../../../../docs/kernel");
const loadSchema = (file: string) =>
  JSON.parse(readFileSync(path.join(kernel, file), "utf-8"));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const set = (o: Record<string, unknown>, p: string, v: unknown) => {
  const parts = p.split(".");
  let cur: any = o;
  for (const k of parts.slice(0, -1)) cur = cur[k];
  if (v === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = v;
  return o;
};

interface Case {
  name: string;
  zod: ZodTypeAny;
  file: string;
  valid: Record<string, unknown>;
  invalid: Array<[string, (v: Record<string, unknown>) => unknown]>;
}

const cases: Case[] = [
  {
    name: "observed",
    zod: ObservedReport,
    file: "observed.schema.json",
    valid: observed,
    invalid: [
      ["missing commit", (v) => set(v, "repo.commit", undefined)],
      ["unknown top-level key", (v) => set(v, "extra", 1)],
      ["type on a package", (v) => set(v, "packages.items.0.type", "core")],
      ["layer on a package", (v) => set(v, "packages.items.0.layer", "domain")],
      ["plane at top", (v) => set(v, "plane", "x")],
      ["context at top", (v) => set(v, "context", "x")],
      ["type on an edge", (v) => set(v, "edges.items.0.type", "x")],
      [
        "uncollected arm without reason",
        (v) => set(v, "packages", { collected: false }),
      ],
      [
        "collected arm with a reason key",
        (v) => set(v, "packages.reason", "x"),
      ],
      ["bad schemaVersion major", (v) => set(v, "schemaVersion", "2.0.0")],
      ["empty package name", (v) => set(v, "packages.items.0.name", "")],
    ],
  },
  {
    name: "slice",
    zod: Slice,
    file: "slice.schema.json",
    valid: slice,
    invalid: [
      ["dotdot path", (v) => set(v, "paths", ["a/../b"])],
      ["absolute path", (v) => set(v, "paths", ["/etc"])],
      ["backslash path", (v) => set(v, "paths", ["a\\b"])],
      ["NUL path", (v) => set(v, "paths", ["a\u0000b"])],
      ["dot exclude", (v) => set(v, "excludes", ["."])],
      ["unknown key", (v) => set(v, "layer", "x")],
      ["missing id", (v) => set(v, "id", undefined)],
    ],
  },
  {
    name: "contract",
    zod: Contract,
    file: "contract.schema.json",
    valid: contract,
    invalid: [
      ["bad kind", (v) => set(v, "rules.0.kind", "deny")],
      ["bad severity", (v) => set(v, "rules.0.severity", "fatal")],
      ["dotdot prefix", (v) => set(v, "rules.0.from", "../x/")],
      ["rule missing to", (v) => set(v, "rules.0.to", undefined)],
      [
        "violation missing specifier",
        (v) => set(v, "knownViolations.0.specifier", undefined),
      ],
      ["unknown key", (v) => set(v, "plane", "x")],
    ],
  },
  {
    name: "proposal",
    zod: ProposalMeta,
    file: "proposal.schema.json",
    valid: proposal,
    invalid: [
      ["negative traceSeq", (v) => set(v, "traceSeq", -1)],
      ["fractional traceSeq", (v) => set(v, "traceSeq", 1.5)],
      ["bad path", (v) => set(v, "paths", ["a/../b"])],
      ["missing grantId", (v) => set(v, "grantId", undefined)],
      ["unknown key", (v) => set(v, "x", 1)],
    ],
  },
  {
    name: "bundle",
    zod: BundleIndex,
    file: "bundle.schema.json",
    valid: bundle,
    invalid: [
      ["short hmac", (v) => set(v, "hmac", "abc")],
      ["uppercase sha", (v) => set(v, "files.0.sha256", "A".repeat(64))],
      [
        "signing key in bundle",
        (v) => set(v, "files.0.path", ".hexagen/grant-signing.key"),
      ],
      [
        "keys dir in bundle",
        (v) => set(v, "files.0.path", "home/.hexagen/keys/eng.key"),
      ],
      ["env file in bundle", (v) => set(v, "files.0.path", ".env.local")],
      ["unknown role", (v) => set(v, "files.0.role", "secret")],
      ["dotdot path", (v) => set(v, "files.0.path", "../x")],
    ],
  },
  {
    name: "tip",
    zod: Tip,
    file: "tip.schema.json",
    valid: tip,
    invalid: [
      ["negative seq", (v) => set(v, "seq", -1)],
      ["short hash", (v) => set(v, "hash", "ab")],
      ["missing hmac", (v) => set(v, "hmac", undefined)],
      ["unknown key", (v) => set(v, "x", 1)],
    ],
  },
];

describe.each(cases)("$name: zod and JSON Schema agree", (c) => {
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = ajv.compile(loadSchema(c.file));

  it("the valid sample passes both", () => {
    expect(c.zod.safeParse(c.valid).success).toBe(true);
    expect(validate(c.valid)).toBe(true);
  });

  it.each(c.invalid)("%s fails both", (_name, mutate) => {
    const v = clone(c.valid);
    mutate(v);
    expect(c.zod.safeParse(v).success).toBe(false);
    expect(validate(v)).toBe(false);
  });
});

describe("observed report invariants", () => {
  it("accepts every section in its uncollected arm", () => {
    const o = clone(observed) as Record<string, unknown>;
    for (const k of [
      "packages",
      "languages",
      "build",
      "generated",
      "dontTouch",
      "edges",
      "unresolved",
    ]) {
      o[k] = { collected: false, reason: "not read" };
    }
    expect(ObservedReport.safeParse(o).success).toBe(true);
    const ajv = new Ajv({ strict: false, validateFormats: false });
    expect(ajv.compile(loadSchema("observed.schema.json"))(o)).toBe(true);
  });

  it("never declares a type, layer, plane or context property anywhere", () => {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "properties" && v && typeof v === "object") {
            names.push(...Object.keys(v));
          }
          walk(v);
        }
      }
    };
    walk(loadSchema("observed.schema.json"));
    expect(names.length).toBeGreaterThan(10);
    for (const k of ["type", "layer", "plane", "context"]) {
      expect(names).not.toContain(k);
    }
  });
});

describe("contract reserved rule id", () => {
  it("the built-in id is unresolved-import", () => {
    expect(UNRESOLVED_IMPORT_RULE_ID).toBe("unresolved-import");
  });
});
