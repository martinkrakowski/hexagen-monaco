import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRepositoryWriter } from "../doubles/in-memory-repository-writer.double.js";

describe("InMemoryRepositoryWriter (double for commitFiles)", () => {
  it("commits a changed file and returns success with sha/url", async () => {
    const double = new InMemoryRepositoryWriter();
    const link = { owner: "acme", repo: "demo", branch: "main" };
    const files = { "src/hello.ts": 'console.log("hi from push");' };
    const res = await double.commitFiles(link, files, "test: editor push");

    assert.strictEqual(res.success, true);
    if (res.success) {
      assert.ok(res.value.commitSha.startsWith("deadbeef"));
      assert.ok(res.value.commitUrl.includes("commit/"));
    }
    assert.strictEqual(double.commits.length, 1);
    assert.deepStrictEqual(double.commits[0].files, files);
    assert.strictEqual(double.commits[0].message, "test: editor push");
  });

  it("records multiple commits", async () => {
    const double = new InMemoryRepositoryWriter();
    await double.commitFiles(
      { owner: "o", repo: "r", branch: "main" },
      { "a.txt": "1" },
      "c1",
    );
    await double.commitFiles(
      { owner: "o", repo: "r", branch: "main" },
      { "b.txt": "2" },
      "c2",
    );
    assert.strictEqual(double.commits.length, 2);
  });
});
