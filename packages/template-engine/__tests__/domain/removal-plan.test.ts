import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  normaliseRecordedPath,
  planTemplateRemoval,
  recordedPaths,
} from "../../src/domain/removal-plan.js";
import type {
  RecordedFileState,
  RemovalPlan,
} from "../../src/domain/removal-plan.js";
import type {
  GeneratedFileRecord,
  TemplateConfig,
  TemplateInstallRecord,
} from "../../src/domain/template-config.js";

function installRecord(
  generatedFiles: GeneratedFileRecord[],
): TemplateInstallRecord {
  return {
    installedAt: "2026-01-01T00:00:00Z",
    version: "1.0.0",
    answers: {},
    generatedFiles,
  };
}

function makeConfig(
  templates: Record<string, TemplateInstallRecord>,
): TemplateConfig {
  return { schemaVersion: "1", templates };
}

describe("normaliseRecordedPath", () => {
  it("keeps an already-normalised path", () => {
    assert.equal(normaliseRecordedPath("a/b.ts"), "a/b.ts");
  });

  it("keeps names that only look like the protected ones", () => {
    for (const ok of [".gitignore", ".github/workflows/ci.yml", "a/.git/x"]) {
      assert.equal(normaliseRecordedPath(ok), ok);
    }
  });

  it("drops '.' and empty segments", () => {
    assert.equal(normaliseRecordedPath("./a//b.ts"), "a/b.ts");
  });

  it("resolves 'x/..' segments", () => {
    assert.equal(normaliseRecordedPath("a/x/../b.ts"), "a/b.ts");
  });

  it("returns null for every unsafe input", () => {
    const unsafe = [
      "/etc/passwd",
      "../x",
      "a/../../x",
      "C:/x",
      "a\\b",
      "",
      ".",
      "a/..",
      "a\0b",
      ".hexagen-template-config.json",
      "./.hexagen-template-config.json",
      ".hexagen-template-config.json.tmp.123",
      ".git/config",
      "x/../.git/config",
      // Letter case: one file on macOS and Windows.
      ".GIT/config",
      ".Git/hooks/pre-commit",
      ".Hexagen-Template-Config.json",
      ".HEXAGEN-TEMPLATE-CONFIG.JSON.tmp.1",
      // Windows drops trailing dots and spaces from a component.
      ".git./config",
      ".git /config",
      ".hexagen-template-config.json.",
      "a/b.txt.",
      "a /b.txt",
      // A colon names an alternate data stream.
      ".hexagen-template-config.json::$DATA",
      ".git:x",
      "a/b.txt:stream",
    ];
    for (const raw of unsafe) {
      assert.equal(
        normaliseRecordedPath(raw),
        null,
        `expected null for ${JSON.stringify(raw)}`,
      );
    }
  });
});

describe("recordedPaths", () => {
  it("returns empty lists when config.templates is not an object", () => {
    const config = { schemaVersion: "1" } as unknown as TemplateConfig;
    assert.deepEqual(recordedPaths(config, "a"), {
      safe: [],
      unsafe: [],
      malformed: 0,
    });
  });

  it("returns empty lists when templateId is not an own key", () => {
    const config = makeConfig({ a: installRecord([]) });
    assert.deepEqual(recordedPaths(config, "b"), {
      safe: [],
      unsafe: [],
      malformed: 0,
    });
  });

  it("returns empty lists for '__proto__' and 'constructor' on an empty registry", () => {
    const config = makeConfig({});
    assert.deepEqual(recordedPaths(config, "__proto__"), {
      safe: [],
      unsafe: [],
      malformed: 0,
    });
    assert.deepEqual(recordedPaths(config, "constructor"), {
      safe: [],
      unsafe: [],
      malformed: 0,
    });
  });

  it("counts a non-array generatedFiles as one malformed record", () => {
    const config = makeConfig({
      a: {
        ...installRecord([]),
        generatedFiles: "nope" as unknown as GeneratedFileRecord[],
      },
    });
    assert.deepEqual(recordedPaths(config, "a"), {
      safe: [],
      unsafe: [],
      malformed: 1,
    });
  });

  it("counts entries without string path and contentHash as malformed and skips them", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "good.ts", contentHash: "h1" },
        null as unknown as GeneratedFileRecord,
        { path: 5, contentHash: "h" } as unknown as GeneratedFileRecord,
        { path: "no-hash.ts" } as unknown as GeneratedFileRecord,
        { path: "also-good.ts", contentHash: "h2" },
      ]),
    });
    assert.deepEqual(recordedPaths(config, "a"), {
      safe: [
        { path: "good.ts", contentHashes: ["h1"] },
        { path: "also-good.ts", contentHashes: ["h2"] },
      ],
      unsafe: [],
      malformed: 3,
    });
  });

  it("collects the RAW path of unsafe entries, once each", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "../outside.txt", contentHash: "h" },
        { path: "../outside.txt", contentHash: "h2" },
        { path: "/abs", contentHash: "h" },
      ]),
    });
    assert.deepEqual(recordedPaths(config, "a"), {
      safe: [],
      unsafe: ["../outside.txt", "/abs"],
      malformed: 0,
    });
  });

  it("normalises, keeps record order, and collects all hashes of a duplicated path", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "./x//b.ts", contentHash: "h1" },
        { path: "y.ts", contentHash: "h3" },
        { path: "x/c/../b.ts", contentHash: "h2" },
        { path: "x/b.ts", contentHash: "h1" },
      ]),
    });
    assert.deepEqual(recordedPaths(config, "a"), {
      safe: [
        { path: "x/b.ts", contentHashes: ["h1", "h2"] },
        { path: "y.ts", contentHashes: ["h3"] },
      ],
      unsafe: [],
      malformed: 0,
    });
  });
});

describe("planTemplateRemoval", () => {
  function plan(
    config: TemplateConfig,
    templateId: string,
    opts: {
      requiresById?: Map<string, readonly string[]>;
      fileStates?: Map<string, RecordedFileState>;
      force?: boolean;
      keepFiles?: boolean;
    } = {},
  ): RemovalPlan {
    return planTemplateRemoval({
      config,
      templateId,
      requiresById: opts.requiresById ?? new Map(),
      fileStates: opts.fileStates ?? new Map(),
      force: opts.force ?? false,
      keepFiles: opts.keepFiles ?? false,
    });
  }

  function states(
    entries: [string, RecordedFileState][],
  ): Map<string, RecordedFileState> {
    return new Map(entries);
  }

  const file = (contentHash: string): RecordedFileState => ({
    kind: "file",
    contentHash,
  });
  const other: RecordedFileState = { kind: "other", detail: "a directory" };
  const absent: RecordedFileState = { kind: "absent" };

  it("is not-installed for a missing template, missing templates, and '__proto__'", () => {
    assert.deepEqual(plan(makeConfig({ a: installRecord([]) }), "b"), {
      kind: "not-installed",
      templateId: "b",
    });
    assert.deepEqual(
      plan({ schemaVersion: "1" } as unknown as TemplateConfig, "a"),
      { kind: "not-installed", templateId: "a" },
    );
    assert.deepEqual(plan(makeConfig({}), "__proto__"), {
      kind: "not-installed",
      templateId: "__proto__",
    });
  });

  it("deletes an unchanged file and keeps a changed one out of deleteFiles", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "same.ts", contentHash: "h1" },
        { path: "edited.ts", contentHash: "h2" },
      ]),
    });
    const fileStates = states([
      ["same.ts", file("h1")],
      ["edited.ts", file("changed-by-user")],
    ]);
    const result = plan(config, "a", { fileStates });
    assert.ok(result.kind === "remove");
    assert.deepEqual(result.deleteFiles, ["same.ts"]);
    assert.deepEqual(result.keptChanged, ["edited.ts"]);
    assert.ok(!result.deleteFiles.includes("edited.ts"));
    assert.deepEqual(result.deleteChanged, []);
  });

  it("deletes a changed file and lists it in deleteChanged only with force", () => {
    const config = makeConfig({
      a: installRecord([{ path: "edited.ts", contentHash: "h2" }]),
    });
    const fileStates = states([["edited.ts", file("changed-by-user")]]);
    const forced = plan(config, "a", { fileStates, force: true });
    assert.ok(forced.kind === "remove");
    assert.deepEqual(forced.deleteFiles, ["edited.ts"]);
    assert.deepEqual(forced.deleteChanged, ["edited.ts"]);
    assert.deepEqual(forced.keptChanged, []);
  });

  it("SAFETY PIN: without force, no changed path is ever in deleteFiles", () => {
    const table: {
      config: TemplateConfig;
      fileStates: Map<string, RecordedFileState>;
    }[] = [
      {
        config: makeConfig({
          a: installRecord([{ path: "x.ts", contentHash: "h1" }]),
        }),
        fileStates: states([["x.ts", file("nope")]]),
      },
      {
        config: makeConfig({
          a: installRecord([
            { path: "b.ts", contentHash: "h1" },
            { path: "c.ts", contentHash: "h2" },
            { path: "d.ts", contentHash: "h3" },
          ]),
        }),
        fileStates: states([
          ["b.ts", file("h1")],
          ["c.ts", file("user-edit")],
          ["d.ts", other],
        ]),
      },
      {
        config: makeConfig({
          a: installRecord([
            { path: "dup.ts", contentHash: "h1" },
            { path: "dup.ts", contentHash: "h9" },
            { path: "solo.ts", contentHash: "h4" },
          ]),
        }),
        fileStates: states([
          ["dup.ts", file("matches-neither")],
          ["solo.ts", absent],
        ]),
      },
    ];
    for (const { config, fileStates } of table) {
      const result = plan(config, "a", { fileStates });
      assert.ok(result.kind === "remove", "table entry must plan a removal");
      // Every changed file of the row is KEPT AND LISTED, so the pin cannot
      // pass on a row where the loop below has nothing to look at.
      let changedInRow = 0;
      for (const recorded of recordedPaths(config, "a").safe) {
        const state = fileStates.get(recorded.path);
        if (
          state !== undefined &&
          state.kind === "file" &&
          !recorded.contentHashes.includes(state.contentHash)
        ) {
          changedInRow += 1;
          assert.ok(
            result.keptChanged.includes(recorded.path),
            `${recorded.path} changed and is not listed as kept`,
          );
          assert.ok(!result.deleteFiles.includes(recorded.path));
        }
      }
      assert.ok(changedInRow > 0, "every row must hold a changed file");
      for (const path of result.deleteFiles) {
        const state = fileStates.get(path);
        assert.ok(
          state !== undefined && state.kind === "file",
          `${path} was deleted without a readable file state`,
        );
        if (state.kind === "file") {
          const recorded = recordedPaths(config, "a").safe.find(
            (candidate) => candidate.path === path,
          );
          assert.ok(
            recorded !== undefined &&
              recorded.contentHashes.includes(state.contentHash),
            `${path} was deleted although its hash changed`,
          );
        }
      }
    }
  });

  it("keeps a shared path, also with force, also written non-normalised by the other record", () => {
    const config = makeConfig({
      a: installRecord([{ path: "a/x.ts", contentHash: "h1" }]),
      b: installRecord([{ path: "./a/../a/x.ts", contentHash: "h9" }]),
    });
    const fileStates = states([["a/x.ts", file("h1")]]);
    for (const force of [false, true]) {
      const result = plan(config, "a", {
        fileStates,
        force,
        requiresById: new Map([["b", []]]),
      });
      assert.ok(result.kind === "remove");
      assert.deepEqual(result.keptShared, ["a/x.ts"]);
      assert.deepEqual(result.deleteFiles, []);
      assert.deepEqual(result.deleteChanged, []);
    }
  });

  it("keeps a path another template records in a different letter case or Unicode form, also with force", () => {
    const nfc = "caf\u00e9.ts";
    const nfd = "cafe\u0301.ts";
    const config = makeConfig({
      a: installRecord([
        { path: "src/A.txt", contentHash: "h1" },
        { path: nfc, contentHash: "h2" },
      ]),
      b: installRecord([
        { path: "SRC/a.txt", contentHash: "h1" },
        { path: nfd, contentHash: "h2" },
      ]),
    });
    const fileStates = states([
      ["src/A.txt", file("h1")],
      [nfc, file("h2")],
    ]);
    for (const force of [false, true]) {
      const result = plan(config, "a", {
        fileStates,
        force,
        requiresById: new Map([["b", []]]),
      });
      assert.ok(result.kind === "remove");
      assert.deepEqual(result.keptShared, [nfc, "src/A.txt"].sort());
      assert.deepEqual(result.deleteFiles, []);
    }
  });

  it("classifies absent as alreadyAbsent and other or unknown state as keptOther, also with force", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "gone.ts", contentHash: "h1" },
        { path: "dir.ts", contentHash: "h2" },
        { path: "unknown.ts", contentHash: "h3" },
      ]),
    });
    const fileStates = states([
      ["gone.ts", absent],
      ["dir.ts", other],
    ]);
    for (const force of [false, true]) {
      const result = plan(config, "a", { fileStates, force });
      assert.ok(result.kind === "remove");
      assert.deepEqual(result.alreadyAbsent, ["gone.ts"]);
      assert.deepEqual(result.keptOther, ["dir.ts", "unknown.ts"]);
      assert.deepEqual(result.deleteFiles, []);
    }
  });

  it("keepFiles moves every would-be deletion to keptByFlag and deletes nothing, also with force", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "same.ts", contentHash: "h1" },
        { path: "edited.ts", contentHash: "h2" },
      ]),
    });
    const fileStates = states([
      ["same.ts", file("h1")],
      ["edited.ts", file("changed-by-user")],
    ]);
    const quiet = plan(config, "a", { fileStates, keepFiles: true });
    assert.ok(quiet.kind === "remove");
    assert.deepEqual(quiet.deleteFiles, []);
    assert.deepEqual(quiet.deleteChanged, []);
    assert.deepEqual(quiet.keptByFlag, ["same.ts"]);
    assert.deepEqual(quiet.keptChanged, ["edited.ts"]);
    const forced = plan(config, "a", {
      fileStates,
      keepFiles: true,
      force: true,
    });
    assert.ok(forced.kind === "remove");
    assert.deepEqual(forced.deleteFiles, []);
    assert.deepEqual(forced.deleteChanged, []);
    assert.deepEqual(forced.keptByFlag, ["edited.ts", "same.ts"]);
    assert.deepEqual(forced.keptChanged, []);
  });

  it("refuses with the dependents' names, and lists them as broken only with force", () => {
    const config = makeConfig({
      a: installRecord([{ path: "a.ts", contentHash: "h1" }]),
      b: installRecord([]),
      c: installRecord([]),
    });
    const requiresById = new Map<string, readonly string[]>([
      ["b", ["a"]],
      ["c", []],
    ]);
    const refused = plan(config, "a", { requiresById });
    assert.deepEqual(refused, {
      kind: "refused",
      templateId: "a",
      refusals: [{ kind: "dependents", templates: ["b"] }],
    });
    const forced = plan(config, "a", { requiresById, force: true });
    assert.ok(forced.kind === "remove");
    assert.deepEqual(forced.brokenDependents, ["b"]);
    assert.deepEqual(forced.unknownDependents, []);
  });

  it("refuses on an installed template with no loadable manifest, and lists it with force", () => {
    const config = makeConfig({
      a: installRecord([{ path: "a.ts", contentHash: "h1" }]),
      b: installRecord([]),
    });
    const refused = plan(config, "a", { requiresById: new Map() });
    assert.deepEqual(refused, {
      kind: "refused",
      templateId: "a",
      refusals: [{ kind: "unknown-dependents", templates: ["b"] }],
    });
    const forced = plan(config, "a", { force: true });
    assert.ok(forced.kind === "remove");
    assert.deepEqual(forced.unknownDependents, ["b"]);
    assert.deepEqual(forced.brokenDependents, []);
  });

  it("refuses unsafe recorded paths naming the raw paths, also with force; keepFiles removes without deleting", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "../outside.txt", contentHash: "h1" },
        { path: "/abs", contentHash: "h1" },
        { path: ".git/config", contentHash: "h1" },
      ]),
    });
    const expectedPaths = ["../outside.txt", "/abs", ".git/config"];
    for (const force of [false, true]) {
      assert.deepEqual(plan(config, "a", { force }), {
        kind: "refused",
        templateId: "a",
        refusals: [{ kind: "unsafe-paths", paths: expectedPaths }],
      });
    }
    const quiet = plan(config, "a", { keepFiles: true });
    assert.ok(quiet.kind === "remove");
    assert.deepEqual(quiet.deleteFiles, []);
    assert.deepEqual(quiet.keptByFlag, []);
    assert.deepEqual(quiet.keptOther, []);
    assert.deepEqual(quiet.alreadyAbsent, []);
    assert.equal(quiet.malformedRecords, 0);
  });

  it("reports every refusal that applies at once", () => {
    const config = makeConfig({
      a: installRecord([{ path: "../outside.txt", contentHash: "h1" }]),
      b: installRecord([]),
      c: installRecord([]),
    });
    const requiresById = new Map<string, readonly string[]>([["b", ["a"]]]);
    const refused = plan(config, "a", { requiresById });
    assert.deepEqual(refused, {
      kind: "refused",
      templateId: "a",
      refusals: [
        { kind: "dependents", templates: ["b"] },
        { kind: "unknown-dependents", templates: ["c"] },
        { kind: "unsafe-paths", paths: ["../outside.txt"] },
      ],
    });
  });

  it("deletes a file that matches the second hash of a duplicated record entry", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "dup.ts", contentHash: "h1" },
        { path: "dup.ts", contentHash: "h2" },
      ]),
    });
    const fileStates = states([["dup.ts", file("h2")]]);
    const result = plan(config, "a", { fileStates });
    assert.ok(result.kind === "remove");
    assert.deepEqual(result.deleteFiles, ["dup.ts"]);
    assert.deepEqual(result.deleteChanged, []);
  });

  it("plans a removal with nothing to delete when generatedFiles is not an array", () => {
    const config = makeConfig({
      a: {
        ...installRecord([]),
        generatedFiles: "nope" as unknown as GeneratedFileRecord[],
      },
    });
    const result = plan(config, "a");
    assert.ok(result.kind === "remove");
    assert.deepEqual(result.deleteFiles, []);
    assert.equal(result.malformedRecords, 1);
  });

  it("does not mutate its input config", () => {
    const config = makeConfig({
      a: installRecord([
        { path: "same.ts", contentHash: "h1" },
        { path: "bad", contentHash: "h2" },
      ]),
      b: installRecord([{ path: "shared.ts", contentHash: "h3" }]),
    });
    const before = structuredClone(config);
    plan(config, "a", {
      requiresById: new Map([["b", ["a"]]]),
      fileStates: states([["same.ts", file("h1")]]),
      force: true,
    });
    assert.deepEqual(config, before);
  });
});
