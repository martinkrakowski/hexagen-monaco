import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpolate } from "@hexagen/shared";

// The template engine relies on `interpolate` (@hexagen/shared) to reserve only
// *bare* `{var}` placeholders and to leave every `$`-prefixed expression alone.
// These cases lock that contract so a template can safely contain JS template
// literals, shell expansion, and GitHub Actions expressions.
describe("interpolate — placeholder vs $-prefixed expressions", () => {
  it("substitutes a bare {var} placeholder", () => {
    const r = interpolate("node-version: {v}", { v: "22" });
    assert.equal(r.output, "node-version: 22");
    assert.deepEqual(r.warnings, []);
  });

  it("warns and preserves an unknown bare placeholder", () => {
    const r = interpolate("x = {missing}", {});
    assert.equal(r.output, "x = {missing}");
    assert.deepEqual(r.warnings, ["missing"]);
  });

  it("leaves a JS template literal ${expr} untouched (no warning)", () => {
    const r = interpolate("`status ${res.status}: ${body}`", {});
    assert.equal(r.output, "`status ${res.status}: ${body}`");
    assert.deepEqual(r.warnings, []);
  });

  it("does NOT rewrite ${id} even when id is a provided variable", () => {
    // The footgun: a JS literal must never be replaced by an answer value.
    const r = interpolate("`hi ${name}`", { name: "REPLACED" });
    assert.equal(r.output, "`hi ${name}`");
    assert.deepEqual(r.warnings, []);
  });

  it("leaves shell expansion ${VAR} untouched", () => {
    const r = interpolate('echo "${HOME}/bin"', { HOME: "x" });
    assert.equal(r.output, 'echo "${HOME}/bin"');
    assert.deepEqual(r.warnings, []);
  });

  it("passes GitHub Actions ${{ ... }} expressions through verbatim", () => {
    const src = "key: ${{ runner.os }}-${{ github.sha }}";
    const r = interpolate(src, {});
    assert.equal(r.output, src);
    assert.deepEqual(r.warnings, []);
  });

  it("still honours {{ }} brace escapes", () => {
    assert.equal(interpolate("{{literal}}", {}).output, "{literal}");
  });

  it("distinguishes ${var} (left as-is) from bare {var} (interpolated)", () => {
    assert.equal(
      interpolate("cost: ${amount}", { amount: "5" }).output,
      "cost: ${amount}",
    );
    assert.equal(
      interpolate("cost: {amount}", { amount: "5" }).output,
      "cost: 5",
    );
  });

  it("handles the string boundaries (placeholder at offset 0; leading ${...})", () => {
    // A bare placeholder at offset 0 can't be `$`-preceded, so it interpolates.
    assert.equal(interpolate("{x} y", { x: "Z" }).output, "Z y");
    // A `${...}` at the very start is still left untouched.
    assert.equal(interpolate("${x} y", { x: "Z" }).output, "${x} y");
  });
});
