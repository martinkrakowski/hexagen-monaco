import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { splitTurnsByAuthorHeadings } from "../split-turns";

describe("splitTurnsByAuthorHeadings", () => {
  it("returns null when there are no ## headings", () => {
    assert.strictEqual(
      splitTurnsByAuthorHeadings("just prose\n\nwith paragraphs"),
      null,
    );
  });

  it("returns null for a single heading (ordinary document structure, not turns)", () => {
    assert.strictEqual(
      splitTurnsByAuthorHeadings("## Overview\n\nOne section only"),
      null,
    );
  });

  it("does not treat other heading levels as delimiters", () => {
    // # and ### are not author markers; only exactly-## lines count.
    assert.strictEqual(
      splitTurnsByAuthorHeadings("# Title\n\n### Sub\n\nbody\n\n#### Deep"),
      null,
    );
  });

  it("splits two authored sections into turns with trimmed authors and bodies", () => {
    const turns = splitTurnsByAuthorHeadings(
      "## Grok \n\npropose a thing\n\n## Claude\n\ncritique the thing\n",
    );
    assert.deepStrictEqual(turns, [
      { author: "Grok", content: "propose a thing" },
      { author: "Claude", content: "critique the thing" },
    ]);
  });

  it("captures a non-empty preamble before the first heading as an Imported turn", () => {
    const turns = splitTurnsByAuthorHeadings(
      "Context: the Vellum session.\n\n## Grok\n\nfirst\n\n## Claude\n\nsecond",
    );
    assert.ok(turns);
    assert.strictEqual(turns.length, 3);
    assert.deepStrictEqual(turns[0], {
      author: "Imported",
      content: "Context: the Vellum session.",
    });
    assert.strictEqual(turns[1].author, "Grok");
    assert.strictEqual(turns[2].author, "Claude");
  });

  it("omits a whitespace-only preamble", () => {
    const turns = splitTurnsByAuthorHeadings(
      "\n  \n## Grok\n\nfirst\n\n## Claude\n\nsecond",
    );
    assert.ok(turns);
    assert.strictEqual(turns.length, 2);
    assert.strictEqual(turns[0].author, "Grok");
  });

  it("skips sections whose body trims to empty", () => {
    const turns = splitTurnsByAuthorHeadings(
      "## Grok\n\nreal content\n\n## Claude\n\n   \n\n## You\n\nfinal word",
    );
    assert.ok(turns);
    assert.deepStrictEqual(
      turns.map((t) => t.author),
      ["Grok", "You"],
    );
  });

  it("returns an empty array when every section is empty (caller falls back to single-turn)", () => {
    const turns = splitTurnsByAuthorHeadings("## Grok\n## Claude\n");
    assert.deepStrictEqual(turns, []);
  });

  it("handles CRLF line endings (headings still match, bodies keep no stray \\r)", () => {
    const turns = splitTurnsByAuthorHeadings(
      "preamble\r\n## Grok\r\nline one\r\nline two\r\n## Claude\r\nreply\r\n",
    );
    assert.deepStrictEqual(turns, [
      { author: "Imported", content: "preamble" },
      { author: "Grok", content: "line one\nline two" },
      { author: "Claude", content: "reply" },
    ]);
  });

  it("labels a whitespace-only heading like the load-perimeter salvage does", () => {
    const turns = splitTurnsByAuthorHeadings(
      "##   \nbody one\n## Claude\nbody two",
    );
    assert.ok(turns);
    assert.deepStrictEqual(turns[0], {
      author: "Unknown",
      content: "body one",
    });
  });

  it("keeps markdown inside a section intact (only ## lines delimit)", () => {
    const turns = splitTurnsByAuthorHeadings(
      "## Grok\n\n- bullet\n\n```ts\nconst x = 1;\n```\n\n## Claude\n\nok",
    );
    assert.ok(turns);
    assert.match(turns[0].content, /```ts\nconst x = 1;\n```/);
  });
});
