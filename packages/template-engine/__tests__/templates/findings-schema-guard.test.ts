import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../../src/domain/template-manifest.js";
import { parseFinding } from "../../src/domain/findings/parse-finding.js";
import {
  validateFinding,
  type FindingContext,
  type FindingValidationError,
} from "../../src/domain/findings/validate-finding.js";
import type { Finding } from "../../src/domain/findings/finding.js";
import { discoverTemplateIds } from "../../src/infrastructure/build-template-bundle.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/**
 * Root-relative, POSIX-separated. `path.relative()` is platform-native —
 * backslashes on Windows — so an assertion compared against slash-separated
 * literals would fail there. The template-engine suites do not run in the
 * Windows CI job today, but that filter is one edit away from including this
 * package; normalize instead of betting on it.
 */
function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * The guard half of this file: a malformed finding file anywhere under
 * `templates/<id>/findings/` fails CI through the same door the collision and
 * budget guards use. The store is seeded (lane G3, wave 2): the scan must be
 * non-vacuous — the assertions below pin the exact finding files it must find,
 * so a file that goes missing fails by count, not just "some exist".
 */

interface LocatedFinding {
  subjectId: string;
  file: string;
  text: string;
}

/**
 * F-D1's filename shape: `NNNN-<slug>.md` — four digits, then a lowercase
 * kebab slug. Captured so the id agreement can compare the front matter's
 * `id` against the sequence number the filename actually carries.
 */
const FINDING_FILENAME_RE = /^([0-9]{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

async function collectTemplateFindings(
  templatesDir: string,
): Promise<LocatedFinding[]> {
  const ids = await discoverTemplateIds(templatesDir);
  const findings: LocatedFinding[] = [];
  for (const id of ids) {
    await collectFindingsDir(
      path.join(templatesDir, id, "findings"),
      id,
      findings,
    );
  }
  return findings;
}

async function collectFindingsDir(
  dir: string,
  subjectId: string,
  out: LocatedFinding[],
): Promise<void> {
  let entries: Dirent[];
  try {
    // `encoding` must be pinned: without it @types/node's readdir overload
    // yields `Dirent<Buffer>` and `e.name` is no longer a string.
    entries = await fs.readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch (err) {
    // Most templates have no findings/ dir yet — absent is the normal state
    // and must read as "no findings", not as a fault.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err; // any other IO fault must surface, not read as "no findings"
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Recurse so a bad finding one directory down cannot hide from the scan.
    if (e.isDirectory()) {
      await collectFindingsDir(full, subjectId, out);
      continue;
    }
    // A symlink is scanned as a finding file too, not skipped: readFile
    // dereferences the target, so a bad finding smuggled in behind a link
    // would otherwise escape the net exactly as a real file. A broken .md
    // link surfaces as an IO error rather than a silent skip. Symlinked
    // directories are NOT recursed — a link can point anywhere, and a cycle
    // would hang the scan.
    if (!e.name.endsWith(".md")) continue;
    out.push({
      subjectId,
      file: full,
      text: await fs.readFile(full, "utf-8"),
    });
  }
}

async function templateContext(
  templatesDir: string,
  subjectId: string,
): Promise<FindingContext> {
  const manifest = validateManifest(
    JSON.parse(
      await fs.readFile(
        path.join(templatesDir, subjectId, "manifest.json"),
        "utf-8",
      ),
    ),
  );
  const versions = new Map([[subjectId, manifest.version]]);
  return {
    subjectId,
    subjectKind: "template",
    locationLabel: `templates/${subjectId}/findings/`,
    currentVersion: (kind, id) =>
      kind === "template" ? versions.get(id) : undefined,
    generatorRoot: REPO_ROOT,
  };
}

describe("template guard — finding file schema", () => {
  it("every template finding file parses and validates against its template", async () => {
    const found = await collectTemplateFindings(TEMPLATES_DIR);
    // Non-vacuous since lane G3 seeded the store: assert the count and the
    // exact file set, so a missing finding file fails instead of an empty
    // (vacuously green) scan.
    assert.equal(
      found.length,
      2,
      "the seeded store holds exactly two template findings",
    );
    assert.deepStrictEqual(found.map((f) => rel(REPO_ROOT, f.file)).sort(), [
      "packages/template-engine/templates/agents-md/findings/0001-session-log-grows-unbounded.md",
      "packages/template-engine/templates/ci-github-actions/findings/0001-ci-runners-have-no-zsh.md",
    ]);
    const failures: string[] = [];
    for (const f of found) {
      const context = await templateContext(TEMPLATES_DIR, f.subjectId);
      const result = validateFinding(f.text, context);
      if (result.success) {
        // F-D1: the filename must carry the NNNN-<slug>.md shape, and the id
        // must be the zero-padded sequence number it starts with — the
        // committed store must be internally consistent, not merely
        // schema-valid. The whole filename is checked, not a four-character
        // prefix: `0001anything.md` must not satisfy a check its name implies.
        const filename = path.basename(f.file);
        const shaped = FINDING_FILENAME_RE.exec(filename);
        if (!shaped) {
          failures.push(
            `${rel(REPO_ROOT, f.file)} — filename '${filename}' does not match ` +
              `the NNNN-<slug>.md shape (F-D1): four digits, a hyphen, a ` +
              `lowercase kebab slug, .md`,
          );
          continue;
        }
        if (result.value.id !== shaped[1]) {
          failures.push(
            `${rel(REPO_ROOT, f.file)} — id '${result.value.id}' does not match ` +
              `the filename sequence number '${shaped[1]}'`,
          );
        }
        continue;
      }
      failures.push(
        `${rel(REPO_ROOT, f.file)} — ${result.error.field}: ${result.error.message}`,
      );
    }
    assert.deepStrictEqual(
      failures,
      [],
      `Template finding files must pass the finding schema validator:\n  ` +
        failures.join("\n  "),
    );
  });
});

/**
 * The guard's collection must see finding files however they are smuggled in —
 * not just as flat regular files. The reviewer's demo: a bad finding in
 * `findings/9000-bad.md` fails the suite, while the identical file symlinked in
 * as `findings/9001-symlink.md` (and any file one directory down) sailed
 * through because the scan was `isFile()`-only and non-recursive. These tests
 * build a fixture in a temp dir and prove every shape is collected and
 * refused.
 */
describe("template guard — recursion and symlink coverage", () => {
  it("collects a finding file behind a symlink and one directory down", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "findings-guard-"));
    try {
      const subject = path.join(tmp, "ci-github-actions");
      await fs.mkdir(path.join(subject, "findings", "nested"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(subject, "manifest.json"),
        JSON.stringify({
          id: "ci-github-actions",
          name: "CI",
          description: "d",
          version: "1.3.0",
        }),
      );
      const bad = findingText({ projectName: "campaign-foundry" });
      const flat = path.join(subject, "findings", "1000-bad.md");
      await fs.writeFile(flat, bad);
      await fs.symlink(flat, path.join(subject, "findings", "1001-symlink.md"));
      const nested = path.join(subject, "findings", "nested", "2000-nested.md");
      await fs.writeFile(nested, bad);

      const located = await collectTemplateFindings(tmp);
      assert.deepStrictEqual(located.map((f) => rel(tmp, f.file)).sort(), [
        "ci-github-actions/findings/1000-bad.md",
        "ci-github-actions/findings/1001-symlink.md",
        "ci-github-actions/findings/nested/2000-nested.md",
      ]);
      // The guard must be blind to none of them: each is read (symlink
      // dereferenced) and refused by the schema.
      for (const f of located) {
        const result = validateFinding(f.text, baseContext());
        assert.ok(!result.success, `${rel(tmp, f.file)} must fail`);
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * Fixture half of this file (tests construct their own findings). The
 * canonical fixture mirrors §2 of the plan.
 */

const FIXTURE_BODY = [
  "## What happens",
  "",
  "The emitted workflow runs tests on ubuntu-latest, which lacks zsh.",
].join("\n");

function findingText(
  overrides: Record<string, string | null> = {},
  body: string = FIXTURE_BODY,
): string {
  const lines = [
    "id: 0001",
    "subject: ci-github-actions",
    "subjectKind: template",
    'subjectVersion: "1.2.0"',
    'fixedIn: "1.3.0"',
    "class: host-assumption",
    "severity: high",
    "surface: ci",
    "status: fixed",
  ];
  for (const [key, value] of Object.entries(overrides)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    const line = value === null ? `${key}: null` : `${key}: ${value}`;
    if (index === -1) lines.push(line);
    else lines[index] = line;
  }
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function dropKey(text: string, key: string): string {
  return text.replace(new RegExp(`^${key}:.*\n`, "m"), "");
}

const KNOWN_TEMPLATES: Record<string, string> = {
  "ci-github-actions": "1.3.0",
  docker: "1.2.0",
};

const baseContext = (): FindingContext => ({
  subjectId: "ci-github-actions",
  subjectKind: "template",
  locationLabel: "templates/ci-github-actions/findings/",
  currentVersion: (kind, id) =>
    kind === "template" ? KNOWN_TEMPLATES[id] : undefined,
  generatorRoot: "/repo",
});

function expectSuccess(
  text: string,
  context: FindingContext = baseContext(),
): Finding {
  const result = validateFinding(text, context);
  if (!result.success) {
    assert.fail(
      `expected the finding to validate, got ${result.error.field}: ${result.error.message}`,
    );
  }
  return result.value;
}

function expectFailure(
  text: string,
  expectedField: string,
  context: FindingContext = baseContext(),
  messageContains?: string,
): FindingValidationError {
  const result = validateFinding(text, context);
  if (result.success) {
    assert.fail(
      `expected the finding to be refused (field '${expectedField}')`,
    );
  }
  assert.equal(
    result.error.field,
    expectedField,
    `message for context: ${result.error.message}`,
  );
  if (messageContains !== undefined) {
    assert.ok(
      result.error.message.includes(messageContains),
      `message should mention '${messageContains}': ${result.error.message}`,
    );
  }
  return result.error;
}

describe("parse-finding — the hand-rolled front-matter parser", () => {
  it("parses the §2 canonical front matter into nine scalars plus the body", () => {
    const result = parseFinding(findingText());
    if (!result.success) assert.fail(result.error.message);
    assert.equal(result.value.frontMatter.size, 9);
    assert.equal(result.value.frontMatter.get("id"), "0001");
    assert.equal(result.value.frontMatter.get("subject"), "ci-github-actions");
    assert.equal(result.value.frontMatter.get("subjectKind"), "template");
    assert.equal(result.value.frontMatter.get("subjectVersion"), "1.2.0");
    assert.equal(result.value.frontMatter.get("fixedIn"), "1.3.0");
    assert.equal(result.value.frontMatter.get("class"), "host-assumption");
    assert.equal(result.value.frontMatter.get("severity"), "high");
    assert.equal(result.value.frontMatter.get("surface"), "ci");
    assert.equal(result.value.frontMatter.get("status"), "fixed");
    // The body includes the blank line the plan's §2 example puts between the
    // closing fence and the first section heading.
    assert.ok(result.value.body.includes("## What happens"));
  });

  it("strips a trailing # comment from a scalar", () => {
    const result = parseFinding(
      findingText({
        surface: "ci   # ci | build | lint | test | runtime | docs | dx",
      }),
    );
    if (!result.success) assert.fail(result.error.message);
    assert.equal(result.value.frontMatter.get("surface"), "ci");
  });

  it("maps null, ~ and an empty value to null", () => {
    for (const raw of ["null", "~", ""]) {
      const result = parseFinding(findingText({ fixedIn: raw }));
      if (!result.success) assert.fail(result.error.message);
      assert.equal(
        result.value.frontMatter.get("fixedIn"),
        null,
        `raw: ${raw}`,
      );
    }
  });

  it("refuses any front-matter line that is not 'key: value'", () => {
    for (const [label, bad] of [
      ["an indented (nested-map) key", "  subject: docker"],
      ["a blank line", ""],
      ["a bare token", "not a key: value line"],
      ["a block-list item", "- item: one"],
    ] as const) {
      const lines = [
        "---",
        "id: 0001",
        "subject: ci-github-actions",
        "subjectKind: template",
        'subjectVersion: "1.2.0"',
        "fixedIn: null",
        "class: host-assumption",
        "severity: high",
        "surface: ci",
        bad,
        "status: open",
        "---",
        "",
        "## body",
      ];
      const result = parseFinding(lines.join("\n"));
      assert.ok(!result.success, `${label} should be refused`);
      assert.ok(
        result.error.message.includes("key: value"),
        `${label}: ${result.error.message}`,
      );
    }
  });

  it("refuses an unterminated front-matter fence", () => {
    const result = parseFinding("---\nid: 0001\nsubject: docker");
    assert.ok(!result.success);
    assert.ok(result.error.message.includes("unterminated"));
  });

  it("refuses text that does not open with a front-matter fence", () => {
    const result = parseFinding("id: 0001\n---\nbody");
    assert.ok(!result.success);
    assert.equal(result.error.line, 1);
  });

  it("refuses an unbalanced quoted value", () => {
    const result = parseFinding(findingText({ subjectVersion: '"1.2.0' }));
    assert.ok(!result.success);
    assert.ok(result.error.message.includes("quote"));
  });

  it("refuses a duplicated front-matter key, naming it", () => {
    // id: 0002 after id: 0001 — last-wins would make the record disagree with
    // the file that carries it, so the parser refuses the duplicate.
    const lines = findingText().split("\n");
    lines.splice(lines.indexOf("---", 1), 0, "id: 0002");
    const result = parseFinding(lines.join("\n"));
    assert.ok(!result.success);
    assert.ok(result.error.message.includes("duplicate"));
    assert.ok(result.error.message.includes("'id'"));
    assert.equal(result.error.line, lines.indexOf("id: 0002") + 1);
  });
});

describe("validate-finding — the closed-schema validator", () => {
  it("validates the canonical fixed finding", () => {
    const finding = expectSuccess(findingText());
    assert.equal(finding.id, "0001");
    assert.equal(finding.subjectVersion, "1.2.0");
    assert.equal(finding.fixedIn, "1.3.0");
    assert.ok(finding.body.includes("ubuntu-latest"));
  });

  it.each([
    "client-name",
    "acme-corp-bug",
    "1.2.3",
    "00001",
    "123",
    "000a",
  ] as const)(
    "refuses an id that is not a zero-padded sequence number (%s)",
    (id) => {
      const err = expectFailure(
        findingText({ id }),
        "id",
        baseContext(),
        "zero-padded",
      );
      assert.ok(err.message.includes(id), err.message);
    },
  );

  it("accepts the canonical zero-padded id of 0001", () => {
    const finding = expectSuccess(findingText({ id: "0001" }));
    assert.equal(finding.id, "0001");
  });

  it("validates an open finding with fixedIn null", () => {
    expectSuccess(findingText({ fixedIn: null, status: "open" }));
  });

  it("accepts status: wontfix without fixedIn", () => {
    expectSuccess(findingText({ fixedIn: null, status: "wontfix" }));
  });

  it("validates a component finding against a component root", () => {
    const componentContext: FindingContext = {
      subjectId: "arch-linter",
      subjectKind: "component",
      locationLabel: "tools/arch-linter/findings/",
      currentVersion: (kind, id) =>
        kind === "component" && id === "arch-linter" ? "0.9.0" : undefined,
      generatorRoot: "/repo",
    };
    const text = findingText({
      id: "0001",
      subject: "arch-linter",
      subjectKind: "component",
      subjectVersion: "0.8.0",
      fixedIn: null,
      class: "coverage-gap",
      severity: "medium",
      surface: "lint",
      status: "open",
    });
    expectSuccess(text, componentContext);
  });

  it("refuses an unknown front-matter key, naming it", () => {
    const text = findingText({ projectName: "campaign-foundry" });
    expectFailure(text, "projectName", baseContext(), "closed");
  });

  it("refuses a missing front-matter key, naming it", () => {
    expectFailure(dropKey(findingText(), "subject"), "subject", baseContext());
  });

  it.each([
    ["severity", "nuclear"],
    ["surface", "codegen"],
    ["status", "shipped"],
    ["class", "client-specific"],
    ["subjectKind", "plugin"],
  ] as const)("refuses an unknown %s value, naming the field", (field, bad) => {
    expectFailure(
      findingText({ [field]: bad }),
      field,
      baseContext(),
      "one of",
    );
  });

  it("refuses fixedIn on an open finding, naming fixedIn", () => {
    expectFailure(findingText({ status: "open" }), "fixedIn", baseContext());
  });

  it("refuses status: fixed without fixedIn, naming fixedIn (the rot guard)", () => {
    expectFailure(findingText({ fixedIn: null }), "fixedIn", baseContext());
  });

  it.each(["banana", "---", "1.2", "v3.0.0"] as const)(
    "refuses a fixedIn that is not a well-formed semver version (%s)",
    (fixedIn) => {
      const err = expectFailure(
        findingText({ fixedIn }),
        "fixedIn",
        baseContext(),
        "semver",
      );
      assert.ok(err.message.includes("fixedIn"), err.message);
    },
  );

  it("refuses a subjectKind that does not match where the file sits", () => {
    const err = expectFailure(
      findingText({ subjectKind: "component" }),
      "subjectKind",
      baseContext(),
      "templates/ci-github-actions/findings/",
    );
    assert.ok(err.message.includes("template"));
  });

  it("refuses an unknown subject id, naming it", () => {
    expectFailure(
      findingText({ subject: "not-a-template" }),
      "subject",
      baseContext(),
      "unknown subject id 'not-a-template'",
    );
  });

  it("refuses a known subject that is not the directory's subject", () => {
    const err = expectFailure(
      findingText({ subject: "docker" }),
      "subject",
      baseContext(),
      "docker",
    );
    assert.ok(err.message.includes("directory"));
  });

  it.each(["v1.2", "01.2.0", "1.02.3", "1.2.03", "1.0.0-01"] as const)(
    "refuses a subjectVersion that is not well-formed semver (%s)",
    (version) => {
      expectFailure(
        findingText({ subjectVersion: version }),
        "subjectVersion",
        baseContext(),
        "semver",
      );
    },
  );

  it("refuses a subjectVersion ahead of the subject's current version", () => {
    const err = expectFailure(
      findingText({ subjectVersion: "2.0.0" }),
      "subjectVersion",
      baseContext(),
      "ahead",
    );
    assert.ok(err.message.includes("1.3.0"));
  });

  it("refuses a subject whose current manifest version is not well-formed semver, naming the manifest", () => {
    // A manifest at '1.0' (not semver) would make every compareSemver NaN and
    // the not-ahead gate silently pass; the fault is the manifest's, and the
    // error is named 'manifest', not 'subjectVersion'.
    const badManifestContext: FindingContext = {
      ...baseContext(),
      currentVersion: (kind, id) =>
        kind === "template" && id === "ci-github-actions" ? "1.0" : undefined,
    };
    const err = expectFailure(
      findingText({ subjectVersion: "9.9.9" }),
      "manifest",
      badManifestContext,
      "manifest.json",
    );
    assert.ok(err.message.includes("not a well-formed semver"), err.message);
    assert.ok(
      !err.message.includes("ahead of"),
      "a bad current version must not be reported as ahead-of: " + err.message,
    );
  });

  it("refuses the manifest fault even when the finding is not ahead", () => {
    const badManifestContext: FindingContext = {
      ...baseContext(),
      currentVersion: (kind, id) =>
        kind === "template" && id === "ci-github-actions" ? "1.0" : undefined,
    };
    expectFailure(
      findingText({ subjectVersion: "0.1.0" }),
      "manifest",
      badManifestContext,
    );
  });

  it("refuses a body carrying an absolute path outside the generator", () => {
    const body =
      "The bug reproduced at /Users/client/projects/campaign-foundry/src/main.ts on macOS.";
    expectFailure(
      findingText({}, body),
      "body",
      baseContext(),
      "/Users/client",
    );
  });

  it("allows an absolute path under the generator root in a body", () => {
    const body =
      "Relevant manifest: /repo/templates/ci-github-actions/manifest.json";
    expectSuccess(findingText({}, body));
  });

  it.each([
    ["file:///Users/client/secret/src/main.ts", "/Users/client"],
    ["~/Projects/client/secret/src/app.ts", "~/Projects/client"],
    ["../../Users/client/secret/src/app.ts", "/Users/client"],
    ["ROOT=/Users/client/secret/src", "/Users/client"],
    ["\\\\fileserver\\client\\secret\\main.ts", "fileserver"],
    ['" /Users/client/secret/src/main.ts"', "/Users/client"],
  ] as const)(
    "refuses a client path whatever precedes it (%s)",
    (path, messageFragment) => {
      expectFailure(
        findingText({}, `The reporter saw ${path} and confirmed it exists.`),
        "body",
        baseContext(),
        messageFragment,
      );
    },
  );

  it("refuses a Windows drive path from a downstream repo", () => {
    const body = "Open C:\\Users\\client\\secret\\app.ts and reproduce.";
    expectFailure(findingText({}, body), "body", baseContext(), "client");
  });

  it("still accepts repo-relative prose and bare env words", () => {
    const body = [
      "The runner executed node_modules/.bin/x from packages/sync/src/foo.ts",
      "on ubuntu-latest, which lacks zsh.",
    ].join("\n");
    expectSuccess(findingText({}, body));
  });
});

/**
 * Lane G3 layout proofs (F-D0, F-D1, F-D2). `templates/` is copied verbatim
 * and unfiltered into the published CLI (packages/sync/tsup.config.ts
 * onSuccess), and `discoverTemplateIds()` is the single authoritative check
 * on what that directory may contain — it throws by name on anything that is
 * not a template. A findings/ directory inside a template is invisible to
 * that check and rides along with zero build changes; the store seeded here
 * must prove that, not assume it. The component finding (arch-linter) lives
 * at tools/arch-linter/findings/ — outside the copy input — and therefore
 * cannot ship; these tests assert on the copy INPUT (the templates/ directory
 * itself), because a real tarball/packaging run is disproportionate for a
 * unit guard and the verbatim copy makes the input fully determine the
 * tarball contents.
 */
describe("template guard — the findings layout ships for free (lane G3)", () => {
  it("discoverTemplateIds() reports no strays with findings/ directories present", async () => {
    // Throws by name on any stray, so a resolution proves the whole tree.
    const ids = await discoverTemplateIds(TEMPLATES_DIR);
    assert.ok(ids.includes("ci-github-actions"));
    assert.ok(ids.includes("agents-md"));
  });

  it("the component finding lives outside templates/, so the verbatim copy input holds no component finding", async () => {
    // The copy input is exactly packages/template-engine/templates: the set of
    // finding files under it must be exactly the two template findings, and no
    // template directory named arch-linter may exist.
    await assert.doesNotReject(
      fs.access(
        path.join(
          REPO_ROOT,
          "tools",
          "arch-linter",
          "findings",
          "0001-layer-rules-skip-apps.md",
        ),
      ),
      "the component finding should exist at tools/arch-linter/findings/ as an author-facing record",
    );
    const found = await collectTemplateFindings(TEMPLATES_DIR);
    assert.deepStrictEqual(
      found.map((f) => f.subjectId).sort(),
      ["agents-md", "ci-github-actions"],
      "the copy input carries exactly the two template findings",
    );
    assert.ok(
      !found.some(
        (f) => f.subjectId === "arch-linter" || f.file.includes("arch-linter"),
      ),
      "no component finding may sit under templates/ — it would ship",
    );
  });
});
