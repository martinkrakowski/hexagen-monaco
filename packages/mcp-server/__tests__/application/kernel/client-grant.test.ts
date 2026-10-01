/**
 * A client-repo grant omits `contexts` (it never writes `[]`). Pins three
 * things the brownfield workbook depends on:
 * - both canonical-payload functions serialise an absent `contexts` to the
 *   same bytes, and those bytes differ from `contexts: []`;
 * - a client grant signed with a throwaway key verifies and validates
 *   against the Field Kit schema (`.hexagen/grant.schema.json`);
 * - the Field Kit schema accepts the `signature` property.
 *
 * sync's two files are imported by relative path (pure, dependency-free)
 * because mcp-server's tests do not depend on the sync package; this test is
 * the one place both copies are compared.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";
import { canonicalGrantPayload as syncCanonical } from "../../../../sync/src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../../sync/src/commands/grant/sign.js";
import { canonicalGrantPayload as mcpCanonical } from "../../../src/application/kernel/grant.js";

const base = {
  id: "g-client-1",
  principal: "fde",
  agent: "agent-1",
  paths: ["packages/bill/"],
  tools: ["edit_file"],
  mode: "propose" as const,
  expires_at: "2026-10-02T00:00:00.000Z",
};

// mcp-server's Grant still types `contexts` as required; a client grant omits it.
const noContexts = base as never;
const emptyContexts = { ...base, contexts: [] } as never;

const schemaPath = path.resolve(
  __dirname,
  "../../../../../.hexagen/grant.schema.json",
);
const validate = new Ajv({ strict: false, validateFormats: false }).compile(
  JSON.parse(readFileSync(schemaPath, "utf-8")),
);

describe("canonicalGrantPayload with contexts absent", () => {
  it("is byte-identical in sync's and mcp-server's copies", () => {
    const a = syncCanonical(noContexts);
    const b = mcpCanonical(noContexts);
    assert.equal(a, b);
    assert.equal(
      a,
      '{"agent":"agent-1","expires_at":"2026-10-02T00:00:00.000Z","id":"g-client-1","mode":"propose","paths":["packages/bill/"],"principal":"fde","tools":["edit_file"]}',
    );
  });

  it("differs from contexts: []", () => {
    assert.notEqual(syncCanonical(noContexts), syncCanonical(emptyContexts));
    assert.notEqual(mcpCanonical(noContexts), mcpCanonical(emptyContexts));
    assert.equal(syncCanonical(emptyContexts), mcpCanonical(emptyContexts));
  });
});

describe("Field Kit signature description", () => {
  it("names the engagement key resolution and monaco's own key file", () => {
    const d = JSON.parse(readFileSync(schemaPath, "utf-8")).properties.signature
      .description;
    for (const part of [
      "BW-D4",
      "--key-file",
      "HEXAGEN_GRANT_KEY_FILE",
      "~/.hexagen/keys/<engagement>.key",
      ".hexagen/grant-signing.key",
    ]) {
      assert.ok(d.includes(part), part);
    }
  });
});

describe("a signed client grant against the Field Kit schema", () => {
  it("validates, and its signature verifies under the same key", () => {
    const keyHex = randomBytes(32).toString("hex");
    const signature = signGrantPayload(syncCanonical(noContexts), keyHex);
    const grant = { ...base, signature };

    assert.equal("contexts" in grant, false);
    assert.equal(validate(grant), true, JSON.stringify(validate.errors));

    const expected = createHmac("sha256", Buffer.from(keyHex, "hex"))
      .update(mcpCanonical(noContexts))
      .digest("hex");
    assert.equal(signature, expected);
  });

  it("still refuses an unknown property", () => {
    assert.equal(validate({ ...base, slice: "s1" }), false);
  });
});
