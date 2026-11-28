// packages/sync/__tests__/unit/proxy-injection.test.ts
//
// Proxy detection is injected and runs FIRST: a real Proxy is refused with
// every trap counter still at zero, and a missing detector fails closed.

import { describe, expect, it } from "vitest";
import { types } from "node:util";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCodecSchema,
  hasOwnDataProperty,
  readDenseArray,
  readOwnDataProperty,
  resolveRuntimeModule,
} from "../../src/domain/services/codec-schema-builder.js";
import {
  hasOwnPlainProperty,
  readOwnPlainProperty,
  synthesizeValidSample,
  validatePlainRecord,
} from "../../src/domain/services/codec-sample-synthesizer.js";

const TRAPS = [
  "getPrototypeOf",
  "ownKeys",
  "getOwnPropertyDescriptor",
  "has",
  "get",
  "getOwnPropertyNames",
] as const;

function countingProxy<T extends object>(target: T) {
  const counts: Record<string, number> = {};
  const handler: Record<string, unknown> = {};
  for (const trap of TRAPS) {
    handler[trap] = (...args: unknown[]) => {
      counts[trap] = (counts[trap] ?? 0) + 1;
      return (
        Reflect as unknown as Record<string, (...a: unknown[]) => unknown>
      )[trap]?.(...args);
    };
  }
  const proxy = new Proxy(target, handler as ProxyHandler<T>);
  return {
    proxy,
    total: () => Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

const SCHEMA = { kind: "string", maxLength: 4 };

describe("codec schema builder: injected Proxy detector", () => {
  it("refuses a real object Proxy before any trap runs", () => {
    const { proxy, total } = countingProxy({ ...SCHEMA });
    const res = buildCodecSchema(proxy, "t", types.isProxy);
    expect(res.success).toBe(false);
    expect(total()).toBe(0);
  });

  it("refuses a real array Proxy before any trap runs", () => {
    const { proxy, total } = countingProxy(["a"]);
    const res = readDenseArray(proxy, 8, "p", types.isProxy);
    expect(res.success).toBe(false);
    expect(total()).toBe(0);
  });

  it("refuses a Proxy on the property readers before any trap runs", () => {
    const a = countingProxy({ kind: "string" });
    expect(
      readOwnDataProperty(a.proxy, "kind", "p", types.isProxy).success,
    ).toBe(false);
    const b = countingProxy({ kind: "string" });
    expect(
      hasOwnDataProperty(b.proxy, "kind", "p", types.isProxy).success,
    ).toBe(false);
    const c = countingProxy({ codec: {} });
    expect(resolveRuntimeModule(c.proxy, types.isProxy).success).toBe(false);
    expect(a.total() + b.total() + c.total()).toBe(0);
  });

  it("refuses a nested Proxy before any trap runs", () => {
    const { proxy, total } = countingProxy({ a: SCHEMA });
    const res = buildCodecSchema(
      { kind: "object", exact: true, fields: proxy },
      "t",
      types.isProxy,
    );
    expect(res.success).toBe(false);
    expect(total()).toBe(0);
  });

  it("fails closed with no detector: a plain object is refused, a primitive still reads", () => {
    const res = buildCodecSchema({ ...SCHEMA }, "t");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe("HOSTILE_INPUT");
    expect(readOwnDataProperty({ kind: "x" }, "kind", "p").success).toBe(false);
    expect(readDenseArray([], 8, "p").success).toBe(false);
    // A primitive is not refused for the missing detector: it reaches the
    // existing checks and fails there as a malformed contract.
    const prim = buildCodecSchema(42, "t");
    expect(prim.success).toBe(false);
    if (!prim.success) expect(prim.error.code).toBe("MALFORMED_CONTRACT");
    expect(buildCodecSchema({ ...SCHEMA }, "t", types.isProxy).success).toBe(
      true,
    );
  });

  it("treats a detector that throws or a non-function detector as a refusal", () => {
    const throwing = () => {
      throw new Error("boom");
    };
    expect(buildCodecSchema({ ...SCHEMA }, "t", throwing).success).toBe(false);
    expect(buildCodecSchema({ ...SCHEMA }, "t", "no" as never).success).toBe(
      false,
    );
  });
});

describe("codec sample synthesizer: injected Proxy detector", () => {
  it("refuses a real Proxy before any trap runs, on every entry point", () => {
    const a = countingProxy({ kind: "string", maxLength: 4 });
    expect(() => synthesizeValidSample(a.proxy, "p", types.isProxy)).toThrow();
    const b = countingProxy({ x: 1 });
    expect(() => readOwnPlainProperty(b.proxy, "x", types.isProxy)).toThrow();
    const c = countingProxy({ x: 1 });
    expect(() => hasOwnPlainProperty(c.proxy, "x", types.isProxy)).toThrow();
    const d = countingProxy({ x: 1 });
    expect(() => validatePlainRecord(d.proxy, types.isProxy)).toThrow();
    const e = countingProxy([SCHEMA]);
    expect(() =>
      synthesizeValidSample(
        { kind: "object", exact: true, fields: { f: e.proxy } },
        "p",
        types.isProxy,
      ),
    ).toThrow();
    expect(a.total() + b.total() + c.total() + d.total() + e.total()).toBe(0);
  });

  it("fails closed with no detector", () => {
    expect(() => readOwnPlainProperty({ x: 1 }, "x")).toThrow();
    expect(() => validatePlainRecord({ x: 1 })).toThrow();
    expect(() => synthesizeValidSample({ ...SCHEMA }, "p")).toThrow();
    expect(
      synthesizeValidSample({ ...SCHEMA }, "p", types.isProxy),
    ).toBeDefined();
  });
});

describe("no process-global detector remains", () => {
  it("src contains no installIsProxyDetector or looksLikeProxy", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src",
    );
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          /\.tsx?$/.test(name) &&
          /installIsProxyDetector|looksLikeProxy/.test(
            readFileSync(full, "utf8"),
          )
        )
          hits.push(full);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
