import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listFindings,
  FindingStoreError,
} from "../../src/infrastructure/list-findings.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);
const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
);

/**
 * The reader's contract is exercised against a temp tree built here (removed
 * in `finally`), plus the real repo tree as the one fixture we do not control.
 */

interface FindingSeed {
  /** File name under findings/, e.g. "0001-something.md" (or "sub/0002-x.md"). */
  name: string;
  status?: "open" | "fixed" | "wontfix";
  fixedIn?: string | null;
  subjectVersion?: string;
}

function findingContent(subjectId: string, seed: FindingSeed): string {
  const status = seed.status ?? "open";
  const fixedIn = status === "open" ? null : (seed.fixedIn ?? null);
  const lines = [
    "id: 0001",
    `subject: ${subjectId}`,
    "subjectKind: template",
    `subjectVersion: "${seed.subjectVersion ?? "1.0.0"}"`,
    `fixedIn: ${fixedIn === null ? "null" : `"${fixedIn}"`}`,
    "class: host-assumption",
    "severity: high",
    "surface: ci",
    `status: ${status}`,
  ];
  const file = path.basename(seed.name);
  if (/^000[2-9]/.test(file)) {
    const id = file.slice(0, 4);
    lines[0] = `id: ${id}`;
  }
  return `---\n${lines.join("\n")}\n---\n\n## What happens\n\nsynthetic repro.`;
}

async function seedTemplate(
  root: string,
  id: string,
  version: string,
  seeds: FindingSeed[] | null,
): Promise<void> {
  await fs.mkdir(path.join(root, id), { recursive: true });
  await fs.writeFile(
    path.join(root, id, "manifest.json"),
    JSON.stringify({ id, name: id, description: "temp template", version }),
  );
  if (seeds === null) return; // no findings/ directory at all
  const findingsDir = path.join(root, id, "findings");
  await fs.mkdir(findingsDir, { recursive: true });
  for (const seed of seeds) {
    const file = path.join(findingsDir, seed.name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, findingContent(id, seed));
  }
}

/** Build a fresh temp templates directory, hand it to the assertions, clean up. */
async function withTree(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "list-findings-"));
  try {
    await build(root);
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/** The standard four-template tree used by the list/filter tests, below. */
const standardTree = (root: string): Promise<void> =>
  Promise.all([
    seedTemplate(root, "alpha", "1.0.0", [
      { name: "0001-alpha-open.md", status: "open" },
      {
        name: "0002-alpha-fixed.md",
        status: "fixed",
        fixedIn: "0.9.0",
        subjectVersion: "0.8.0",
      },
      { name: "nested/0003-alpha-open.md", status: "open" },
    ]),
    seedTemplate(root, "beta", "2.0.0", null), // no findings directory
    seedTemplate(root, "gamma", "1.0.0", []), // findings directory exists, empty
    seedTemplate(root, "delta", "1.2.0", [
      { name: "0001-delta-open.md", status: "open", subjectVersion: "1.2.0" },
    ]),
  ]).then(() => undefined);

describe("listFindings — the read path", () => {
  it("returns every finding under <dir>/<template>/findings/** recursively, across templates", async () => {
    await withTree(standardTree, async (root) => {
      const found = await listFindings(root);
      assert.deepStrictEqual(
        found.map((f) => [f.subject, f.id]).sort(),
        [
          ["alpha", "0001"],
          ["alpha", "0002"],
          ["alpha", "0003"],
          ["delta", "0001"],
        ].sort(),
      );
    });
  });

  it("an absent templates directory yields an empty list, never an error", async () => {
    await withTree(
      async () => undefined,
      async (root) => {
        assert.deepStrictEqual(
          await listFindings(path.join(root, "not-there")),
          [],
        );
      },
    );
  });

  it("a templates directory with no template subdirectories yields an empty list", async () => {
    // A store whose factory produced nothing but files and dot entries.
    await withTree(
      async (root) => fs.writeFile(path.join(root, "stray.txt"), "no"),
      async (root) => {
        assert.deepStrictEqual(await listFindings(root), []);
      },
    );
  });

  it("a template with an empty findings directory contributes nothing", async () => {
    await withTree(
      (root) => seedTemplate(root, "gamma", "1.0.0", []),
      async (root) => {
        assert.deepStrictEqual(await listFindings(root), []);
      },
    );
  });

  it("a template with no findings directory contributes nothing", async () => {
    await withTree(
      (root) => seedTemplate(root, "beta", "2.0.0", null),
      async (root) => {
        assert.deepStrictEqual(await listFindings(root), []);
      },
    );
  });

  it("the template option narrows to that subject only", async () => {
    await withTree(standardTree, async (root) => {
      const found = await listFindings(root, { template: "alpha" });
      assert.deepStrictEqual(
        found.map((f) => f.subject),
        ["alpha", "alpha", "alpha"],
      );
    });
  });

  it("the status option narrows to that lifecycle status only", async () => {
    await withTree(standardTree, async (root) => {
      const found = await listFindings(root, { status: "fixed" });
      assert.deepStrictEqual(
        found.map((f) => [f.subject, f.id]),
        [["alpha", "0002"]],
      );
    });
  });

  it("the version option excludes a finding whose fixedIn precedes the asked version", async () => {
    await withTree(standardTree, async (root) => {
      // alpha 0002 was fixed in 0.9.0, so a tree at 1.0.0 no longer cares;
      // the three open findings still apply.
      const found = await listFindings(root, { version: "1.0.0" });
      assert.deepStrictEqual(
        found.map((f) => [f.subject, f.id]).sort(),
        [
          ["alpha", "0001"],
          ["alpha", "0003"],
          ["delta", "0001"],
        ].sort(),
      );
    });
  });

  it("present options combine: a query no finding satisfies yields an empty list", async () => {
    await withTree(standardTree, async (root) => {
      const found = await listFindings(root, {
        template: "alpha",
        status: "fixed",
        version: "1.0.0",
      });
      assert.deepStrictEqual(found, []);
    });
  });

  it("a finding file that fails validation fails the call, naming the file", async () => {
    await withTree(
      async (root) => {
        await seedTemplate(root, "delta", "1.2.0", [
          { name: "0001-delta-open.md", status: "open" },
        ]);
        await seedTemplate(root, "alpha", "1.0.0", []);
        // An unknown key smuggles client content past F-D4 if the reader merely
        // skipped it, so the reader must refuse it.
        const bad = `---\nid: 0009\nsubject: alpha\nsubjectKind: template\nsubjectVersion: "1.0.0"\nfixedIn: null\nclass: host-assumption\nseverity: high\nsurface: ci\nstatus: open\nprojectName: somebody-else\n---\n\nbody`;
        await fs.writeFile(
          path.join(root, "alpha", "findings", "0009-bad.md"),
          bad,
        );
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file === path.join(root, "alpha", "findings", "0009-bad.md") &&
            /projectName/.test(err.message) &&
            /unknown front-matter key/.test(err.message),
        );
      },
    );
  });

  it("a malformed finding fails the call even when a filter would have excluded it", async () => {
    // Validation happens before filtering; a corrupt store must not read as
    // "nothing about delta" just because the caller asked only about delta.
    await withTree(
      async (root) => {
        await seedTemplate(root, "delta", "1.2.0", [
          { name: "0001-delta-open.md", status: "open" },
        ]);
        await seedTemplate(root, "alpha", "1.0.0", []);
        const bad = `---\nid: 0009\nsubject: alpha\nsubjectKind: template\nsubjectVersion: "9.9.9"\nfixedIn: null\nclass: host-assumption\nseverity: high\nsurface: ci\nstatus: open\n---\n\nbody`;
        await fs.writeFile(
          path.join(root, "alpha", "findings", "0009-bad.md"),
          bad,
        );
      },
      async (root) => {
        await assert.rejects(() => listFindings(root, { template: "delta" }));
      },
    );
  });

  it("the real repo tree yields exactly the two seeded template findings", async () => {
    const found = await listFindings(TEMPLATES_DIR);
    assert.deepStrictEqual(
      found.map((f) => [f.subject, f.id, f.status]).sort(),
      [
        ["agents-md", "0001", "open"],
        ["ci-github-actions", "0001", "open"],
      ].sort(),
    );
  });
});

/**
 * Plan §4 G4: "No network call is possible — assert the module imports
 * nothing that can make one." A statement about the read path's IMPORTS, so
 * the test reads the reader's own source plus everything it pulls from the
 * findings domain (the modules `listFindings` reads beneath it would sit in
 * anyway) and refuses the transport-capable builtins. The scaffold data in
 * `generated/template-bundle.generated.ts` is deliberately out of scope: it
 * is not part of this module's import graph, and template file contents are
 * not imports.
 */
describe("listFindings — no network is possible", () => {
  it("the read path's source imports no transport module and references no fetch", async () => {
    const files = [
      path.join(SRC, "infrastructure", "list-findings.ts"),
      ...(await fs.readdir(path.join(SRC, "domain", "findings"))).map((f) =>
        path.join(SRC, "domain", "findings", f),
      ),
    ];
    // `node:http` as a substring also covers `node:https`; the rest are
    // exact specifiers. `fetch` is asserted as a whole word so prose like a
    // hypothetical variable name cannot pass while a real call would fail.
    const forbidden: Array<[RegExp, string]> = [
      [/node:http/, "node:http(s)"],
      [/node:net/, "node:net"],
      [/node:dgram/, "node:dgram"],
      [/node:tls/, "node:tls"],
      [/\bfetch\b/, "fetch"],
    ];
    for (const file of files) {
      const text = await fs.readFile(file, "utf-8");
      for (const [pattern, label] of forbidden) {
        assert.doesNotMatch(
          text,
          pattern,
          `${file} must never involve ${label} — the findings read path is a local walk`,
        );
      }
    }
  });
});
