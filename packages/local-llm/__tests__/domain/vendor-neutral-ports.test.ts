/**
 * HEX-028: domain ports describe capability, not vendor mechanics.
 *
 * WebGPU / WebLLM / IndexedDB belong on adapters, not on exported
 * domain port symbols or their JSDoc contracts.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/domain/ports",
);

const CONTEXT_YAML = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.architecture/contexts/probabilistic/local-llm/context.yaml",
);

const VENDOR_NAME = /WebGPU|WebLLM|IndexedDB/i;
const VENDOR_MECHANICS_JSDOC = /IndexedDB|Cache API|WebLLM/i;
const EXPORT_NAME =
  /^export\s+(?:interface|type|class|const|function|enum)\s+(\w+)/gm;

function portSources(): Array<{ file: string; source: string }> {
  return readdirSync(PORTS_DIR)
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .map((file) => ({
      file,
      source: readFileSync(join(PORTS_DIR, file), "utf8"),
    }));
}

function exportedNames(): string[] {
  return portSources().flatMap(({ source }) =>
    [...source.matchAll(EXPORT_NAME)].map((match) => match[1]!),
  );
}

describe("domain ports are vendor-neutral (HEX-028)", () => {
  it("exports no WebGPU / WebLLM / IndexedDB type or port names", () => {
    const offenders: string[] = [];
    for (const { file, source } of portSources()) {
      for (const match of source.matchAll(EXPORT_NAME)) {
        const name = match[1]!;
        if (VENDOR_NAME.test(name)) {
          offenders.push(`${file}:${name}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `vendor names still exported: ${offenders.join(", ")}`,
    );
  });

  it("does not prescribe IndexedDB / Cache API / WebLLM in port JSDoc", () => {
    const offenders: string[] = [];
    for (const { file, source } of portSources()) {
      const docs = source.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
      for (const doc of docs) {
        if (VENDOR_MECHANICS_JSDOC.test(doc)) {
          offenders.push(file);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `vendor mechanics still in JSDoc: ${offenders.join(", ")}`,
    );
  });

  it("declares GraphicsCapabilityPort as the vendor-neutral capability port", () => {
    const names = exportedNames();
    assert.ok(
      names.includes("GraphicsCapabilityPort"),
      "GraphicsCapabilityPort is not exported from domain/ports",
    );
    assert.ok(
      names.includes("GraphicsCapability"),
      "GraphicsCapability is not exported from domain/ports",
    );
  });

  it("GraphicsCapability carries flags only — no GPU handles", () => {
    const file = portSources().find((entry) =>
      /export interface GraphicsCapability\b/.test(entry.source),
    );
    assert.ok(file, "GraphicsCapability is not declared");
    const body =
      file.source.match(
        /export interface GraphicsCapability\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    assert.equal(
      /\badapter\b/.test(body),
      false,
      "GraphicsCapability still leaks an adapter handle",
    );
    assert.equal(
      /\bdevice\b/.test(body),
      false,
      "GraphicsCapability still leaks a device handle",
    );
  });

  it("context.yaml out-port list matches GraphicsCapabilityPort", () => {
    const yaml = readFileSync(CONTEXT_YAML, "utf8");
    assert.match(yaml, /^\s+- GraphicsCapabilityPort$/m);
    assert.doesNotMatch(yaml, /^\s+- WebGPUDetectorPort$/m);
  });
});
