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

  it("a template directory whose manifest declares another id fails the call", async () => {
    // The F-D6 join key: alpha's findings must join against alpha's own
    // manifest version. A directory holding another template's manifest
    // would hang that template's version off this subject's findings —
    // the not-ahead check then runs against a version that has nothing to
    // do with the subject — so the mismatch is refused, naming the
    // directory and both ids.
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", [
          { name: "0001-alpha-open.md", status: "open" },
        ]);
        await fs.writeFile(
          path.join(root, "alpha", "manifest.json"),
          JSON.stringify({
            id: "beta",
            name: "beta",
            description: "betrayed alpha",
            version: "9.9.9",
          }),
        );
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file === path.join(root, "alpha", "manifest.json") &&
            /directory 'alpha'/.test(err.message) &&
            /'beta'/.test(err.message),
        );
      },
    );
  });

  it("an unreadable finding file fails as a FindingStoreError naming the file", async () => {
    // The EACCES fault carries the file it is in, exactly like a schema
    // refusal does — a consumer matching on the exported error type to
    // print "corrupt finding: <file>" gets the typed path, not an
    // unhandled raw fs error. (Skipped under root: chmod cannot block it.)
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", [
          { name: "0001-alpha-open.md", status: "open" },
        ]);
        await fs.chmod(
          path.join(root, "alpha", "findings", "0001-alpha-open.md"),
          0o000,
        );
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file ===
              path.join(root, "alpha", "findings", "0001-alpha-open.md") &&
            /EACCES/.test(err.message),
        );
      },
    );
  });

  it("a dangling symlinked finding fails as a FindingStoreError, not raw ENOENT", async () => {
    // readFile dereferences — and must dereference, a bad finding behind a
    // link cannot hide — so an unresolvable link surfaces from the read as
    // the typed fault naming the file.
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", []);
        await fs.symlink(
          path.join(root, "alpha", "findings", "gone.md"),
          path.join(root, "alpha", "findings", "0001-alpha-open.md"),
          "file",
        );
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file ===
              path.join(root, "alpha", "findings", "0001-alpha-open.md") &&
            /ENOENT/.test(err.message),
        );
      },
    );
  });

  it("a corrupt manifest.json fails as a FindingStoreError naming the manifest", async () => {
    // A SyntaxError names no file at all; the manifest is store structure,
    // so its fault is typed with the manifest's path.
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", [
          { name: "0001-alpha-open.md", status: "open" },
        ]);
        await fs.writeFile(
          path.join(root, "alpha", "manifest.json"),
          "{not json",
        );
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file === path.join(root, "alpha", "manifest.json") &&
            /manifest\.json cannot be read/.test(err.message),
        );
      },
    );
  });

  it("a malformed query version fails as a FindingStoreError before the walk", async () => {
    // Deterministic call-level refusal, file "": there is no store file
    // the fault is in — it is the caller's argument.
    await withTree(standardTree, async (root) => {
      await assert.rejects(
        () => listFindings(root, { version: "banana" }),
        (err: unknown) =>
          err instanceof FindingStoreError &&
          err.file === "" &&
          /query version 'banana' is not a well-formed semver/.test(
            err.message,
          ),
      );
    });
  });

  it("a .MD travel-artifact is seen, never dropped as if absent", async () => {
    // On case-insensitive filesystems (macOS, Windows) an upper-case `.MD` is
    // the same file the finder shows; dropping it would leave a silent hole
    // in "what is known" — the docstring's cardinal sin. The suffix test
    // matches case-insensitively, so the file is read (and held to the same
    // schema as every other finding), never quietly absent.
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", [
          { name: "0001-alpha-open.md", status: "open" },
          { name: "0002-alpha-open2.MD", status: "open" },
        ]);
      },
      async (root) => {
        const found = await listFindings(root);
        assert.deepStrictEqual(found.map((f) => f.id).sort(), ["0001", "0002"]);
      },
    );
  });

  it("a symlinked findings directory pointing outside the templates dir is not followed", async () => {
    // readdir dereferences `findings/` itself, so without a containment pin
    // the walk would read a tree beyond the argument the caller handed over
    // — against the plan's "reads only beneath it", the property that makes
    // listFindings safe to point at an installed package.
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", null);
        const outside =
          path.dirname(root) + "/list-findings-outside-probe-findings";
        await fs.mkdir(outside, { recursive: true });
        await fs.writeFile(
          path.join(outside, "0001-smuggled.md"),
          "Name after an OSHA 10-hour training VHS tape.",
        );
        await fs.symlink(outside, path.join(root, "alpha", "findings"), "dir");
      },
      async (root) => {
        const found = await listFindings(root);
        assert.deepStrictEqual(found, []);
      },
    );
  });

  it("a plain file in findings' place reads as no findings, never as raw ENOTDIR", async () => {
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", null);
        await fs.writeFile(path.join(root, "alpha", "findings"), "stray");
      },
      async (root) => {
        const found = await listFindings(root);
        assert.deepStrictEqual(found, []);
      },
    );
  });

  it("a symlinked directory named 0009-dirlink.md is a not-followed dir, never raw EISDIR", async () => {
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", [
          { name: "real-dir/0001-alpha-open.md", status: "open" },
        ]);
        await fs.symlink(
          path.join(root, "alpha", "findings", "real-dir"),
          path.join(root, "alpha", "findings", "0009-dirlink.md"),
          "dir",
        );
      },
      async (root) => {
        const found = await listFindings(root);
        // the link is skipped as a directory (the docstring's not-followed
        // rule, classed by its RESOLVED type); the real sibling still reads.
        assert.deepStrictEqual(
          found.map((f) => [f.subject, f.id]),
          [["alpha", "0001"]],
        );
      },
    );
  });

  it("a filename without the NNNN-<slug>.md shape fails the call, naming the file", async () => {
    // The guard enforces F-D1's shape on the committed store; the reader's
    // subjects are an installed tree it does not control, where nothing
    // has run the guard — so the shape is re-checked here (F-D6's join
    // integrity holds for everyone the reader answers, not just the repo).
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", [
          { name: "0001_bad.md", status: "open" },
        ]);
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file === path.join(root, "alpha", "findings", "0001_bad.md") &&
            /NNNN-<slug>\.md shape/.test(err.message),
        );
      },
    );
  });

  it("a finding whose id does not match its filename's sequence fails the call", async () => {
    await withTree(
      async (root) => {
        await seedTemplate(root, "alpha", "1.0.0", []);
        const mismatch = `---\nid: 0002\nsubject: alpha\nsubjectKind: template\nsubjectVersion: "1.0.0"\nfixedIn: null\nclass: host-assumption\nseverity: high\nsurface: ci\nstatus: open\n---\n\nbody`;
        // shape-valid filename 0001-bad-id.md, but its front matter claims id 0002
        await fs.writeFile(
          path.join(root, "alpha", "findings", "0001-bad-id.md"),
          mismatch,
        );
      },
      async (root) => {
        await assert.rejects(
          () => listFindings(root),
          (err: unknown) =>
            err instanceof FindingStoreError &&
            err.file ===
              path.join(root, "alpha", "findings", "0001-bad-id.md") &&
            /id '0002' does not match/.test(err.message) &&
            /'0001'/.test(err.message),
        );
      },
    );
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

  it("every finding in the real repo tree loads and cites a directory that exists", async () => {
    // Structural, not a count: this fixture spans 45 directories the lane
    // does not own — any future finding under templates/**, or any
    // manifest outside the lane becoming unparseable, must not read as a
    // G4 failure in an unrelated lane. The assertion states the behaviour
    // this lane OWNS: the whole real tree loads (so every finding file in
    // it parses, validates, and matches its own directory — listFindings
    // would fail the call otherwise) and every returned subject names a
    // directory that actually sits under templates/. The seeded store
    // keeps the check non-vacuous.
    const found = await listFindings(TEMPLATES_DIR);
    assert.ok(
      found.length >= 1,
      "the seeded store holds findings — a reader that returns nothing must fail visibly, not pass vacuously",
    );
    for (const f of found) {
      await assert.doesNotReject(
        () => fs.stat(path.join(TEMPLATES_DIR, f.subject)),
        `subject '${f.subject}' must name a directory under templates/`,
      );
    }
  });
});

/**
 * Plan §4 G4: "No network call is possible — assert the module imports
 * nothing that can make one." A statement about the module's real IMPORT
 * GRAPH, not about a directory: the test walks transitively from
 * `list-findings.ts` through its relative specifiers, so a value import
 * like `validateManifest` from `../domain/template-manifest.js` — in the
 * graph even though it is not under `findings/` — is asserted too. Bare
 * specifiers (node: builtins, package names) cannot be walked to a source
 * file and are refused by name, and the code of every visited file is
 * scanned for the fetch-family calls. The scaffold data in
 * `generated/template-bundle.generated.ts` stays out of scope: it is not
 * part of this import graph, and template file contents are not imports.
 */
describe("listFindings — no network is possible", () => {
  /**
   * Strip comments and (optionally) string/template/regex bodies. The
   * import scan runs on comment-stripped text with strings KEPT (they are
   * the specifiers); the fetch-word scan runs on code with strings DROPPED,
   * so anything written in prose or template literals — including this
   * file's own descriptions of what is forbidden — is not a call.
   */
  function codeOf(source: string, keepStrings: boolean): string {
    let out = "";
    let prev = ""; // last significant char emitted, for `/` classification
    const push = (c: string): void => {
      if (c === "") return;
      out += c;
      if (!/\s/.test(c)) prev = c;
    };
    let i = 0;
    while (i < source.length) {
      const ch: string = source[i] as string;
      const next: string = source[i + 1] ?? "";
      if (ch === "/" && next === "/") {
        while (i < source.length && source[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        i += 2;
        while (
          i < source.length &&
          !(source[i] === "*" && source[i + 1] === "/")
        )
          i++;
        i += 2;
        push(" ");
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        const quote: string = ch;
        if (keepStrings) push(quote);
        i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === "\\") {
            if (keepStrings) {
              push(source[i] as string);
              push(source[i + 1] ?? "");
            }
            i += 2;
            continue;
          }
          if (keepStrings) push(source[i] as string);
          i++;
        }
        if (i >= source.length) break;
        if (keepStrings) push(quote);
        i++;
        continue;
      }
      // A regex literal only when the `/` lands in operator position;
      // after an identifier it is division, and neither matters here.
      const operatorPrecedes =
        prev === "" || "=,([!&|?:;{}<>+-*%~^".includes(prev);
      if (ch === "/" && operatorPrecedes) {
        if (keepStrings) push("/");
        i++;
        let inClass = false;
        while (i < source.length && (inClass || source[i] !== "/")) {
          const c = source[i] as string;
          if (c === "\\") {
            if (keepStrings) {
              push(c);
              push(source[i + 1] ?? "");
            }
            i += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          if (keepStrings) push(c);
          i++;
        }
        push("/");
        i++;
        while (i < source.length && /[dgimsuvy]/.test(source[i] as string)) {
          if (keepStrings) push(source[i] as string);
          i++;
        }
        continue;
      }
      push(ch);
      i++;
    }
    return out;
  }

  /**
   * The transport-capable specifiers: builtins that open sockets, spawn
   * subprocesses, or resolve network names, plus the npm transports a
   * future import could reach for. `node:fs`, `fs/promises`, and `path`
   * are LOCAL — a filesystem walk needs them and only them.
   */
  const FORBIDDEN_SPECIFIERS = new Set([
    "node:http",
    "node:https",
    "node:http2",
    "node:net",
    "node:tls",
    "node:dgram",
    "node:dns",
    "node:child_process",
    "http",
    "https",
    "http2",
    "undici",
    "axios",
    "got",
    "node-fetch",
    "cross-fetch",
    "superagent",
    "needle",
    "request",
    "request-promise",
  ]);

  const FORBIDDEN_CALLS: Array<[RegExp, string]> = [
    [/\bfetch\b/, "fetch"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
  ];

  /** Where a relative specifier's module really lives, given the `.js`
   * suffix is compiled-away TypeScript (list-findings.ts imports `.js`). */
  async function resolveRelative(
    dir: string,
    spec: string,
  ): Promise<string | null> {
    const base = path.resolve(dir, spec);
    const candidates = [
      base,
      /\.m?[jt]s$/.test(base) ? base.replace(/\.m?js$/, ".ts") : base + ".ts",
      path.join(base, "index.ts"),
    ];
    for (const candidate of candidates) {
      try {
        const stats = await fs.stat(candidate);
        if (stats.isFile()) return candidate;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }

  it("the read path's IMPORT GRAPH transports nothing and calls no fetch", async () => {
    const entry = path.join(SRC, "infrastructure", "list-findings.ts");
    const walked: Array<{ file: string; imports: string[] }> = [];
    const visited = new Set<string>();
    const fifo: Array<{ file: string; dir: string }> = [
      { file: entry, dir: path.dirname(entry) },
    ];
    while (fifo.length > 0) {
      const { file, dir } = fifo.shift() as { file: string; dir: string };
      if (visited.has(file)) continue;
      visited.add(file);
      const source = await fs.readFile(file, "utf-8");
      const code = codeOf(source, true); // comments gone, strings kept
      const stripped = codeOf(source, false); // nothing but code left
      const specs: string[] = [];
      const importRe =
        /(?:\bfrom\s*|\bimport\s*|\bimport\(\s*|\brequire\(\s*)["']([^"']+)["']/g;
      for (const match of code.matchAll(importRe)) {
        const spec: string | undefined = match[1];
        if (spec === undefined) continue;
        specs.push(spec);
        assert.ok(
          !FORBIDDEN_SPECIFIERS.has(spec),
          `${file} imports '${spec}' — the findings read path is a local walk`,
        );
        if (spec.startsWith(".")) {
          const resolved = await resolveRelative(dir, spec);
          assert.ok(
            resolved !== null,
            `${file} imports '${spec}' — the graph walk must resolve it`,
          );
          fifo.push({ file: resolved, dir: path.dirname(resolved) });
        }
        // A bare spec (node: builtin or package) is checked above by name;
        // node:fs-family builtins walk nowhere by design.
      }
      for (const [pattern, label] of FORBIDDEN_CALLS) {
        assert.doesNotMatch(
          stripped,
          pattern,
          `${file} must never involve ${label} — the findings read path is a local walk`,
        );
      }
      walked.push({ file, imports: specs });
    }
    // Non-vacuous: the graph actually reached the domain modules — a
    // broken walk must fail loudly, not silently assert on one file.
    assert.ok(
      walked.some((w) => w.file.includes("template-manifest")),
      "the import graph walk reaches template-manifest.ts (the value import line 11 covers)",
    );
    assert.ok(
      walked.some((w) => w.file.includes("finding-query")),
      "the import graph walk reaches finding-query.ts",
    );
    assert.ok(
      walked.length > 5,
      "the import graph walk is transitive, not one-file deep",
    );
  });
});
