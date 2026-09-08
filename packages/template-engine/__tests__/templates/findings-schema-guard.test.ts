import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
 * The guard half of this file: a malformed finding file anywhere under
 * `templates/<id>/findings/` fails CI through the same door the collision and
 * budget guards use. The store is unseeded today (seeding is lane G3, a later
 * wave), so the guard must pass with zero finding files present — it is a
 * scan-then-validate net, not a fixture-dependent test.
 */

interface LocatedFinding {
  subjectId: string;
  file: string;
  text: string;
}

async function collectTemplateFindings(
  templatesDir: string,
): Promise<LocatedFinding[]> {
  const ids = await discoverTemplateIds(templatesDir);
  const findings: LocatedFinding[] = [];
  for (const id of ids) {
    const findingsDir = path.join(templatesDir, id, "findings");
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(findingsDir, { withFileTypes: true });
    } catch (err) {
      // Most templates have no findings/ dir yet — that is the normal state
      // until G3 seeds the store.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err; // any other IO fault must surface, not read as "no findings"
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const file = path.join(findingsDir, e.name);
      findings.push({
        subjectId: id,
        file,
        text: await fs.readFile(file, "utf-8"),
      });
    }
  }
  return findings;
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
    if (found.length === 0) {
      // Vacuous until lane G3 seeds the store; the guard must pass with no
      // finding files present anywhere (the repo's state until then).
      // eslint-disable-next-line no-console
      console.warn(
        "no finding files under templates/*/findings/ — the store is unseeded (lane G3)",
      );
    }
    const failures: string[] = [];
    for (const f of found) {
      const context = await templateContext(TEMPLATES_DIR, f.subjectId);
      const result = validateFinding(f.text, context);
      if (!result.success) {
        failures.push(
          `${path.relative(REPO_ROOT, f.file)} — ${result.error.field}: ${result.error.message}`,
        );
      }
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
 * Fixture half of this file (tests construct their own findings; seeding the
 * real store is lane G3). The canonical fixture mirrors §2 of the plan.
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
});

describe("validate-finding — the closed-schema validator", () => {
  it("validates the canonical fixed finding", () => {
    const finding = expectSuccess(findingText());
    assert.equal(finding.subjectVersion, "1.2.0");
    assert.equal(finding.fixedIn, "1.3.0");
    assert.ok(finding.body.includes("ubuntu-latest"));
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

  it("refuses a subjectVersion that is not well-formed semver", () => {
    expectFailure(
      findingText({ subjectVersion: "v1.2" }),
      "subjectVersion",
      baseContext(),
      "semver",
    );
  });

  it("refuses a subjectVersion ahead of the subject's current version", () => {
    const err = expectFailure(
      findingText({ subjectVersion: "2.0.0" }),
      "subjectVersion",
      baseContext(),
      "ahead",
    );
    assert.ok(err.message.includes("1.3.0"));
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
});
