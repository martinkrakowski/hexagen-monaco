import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Project } from "ts-morph";
import {
  ADVISORY_DECLARATION_SECTIONS,
  ENFORCED_DECLARATION_SECTIONS,
  checkContextDeclarations,
  collectDeclaredElements,
  collectExportedNames,
  contextDeclarationsEnforced,
  type DeclarationSection,
  type DeclaredElement,
} from "../src/context-declaration-violation.js";

/** Parse a snippet into a real ts-morph SourceFile — no filesystem, no tsconfig. */
function sourceFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/ctx/src/file.ts", code);
}

function names(declared: DeclaredElement[], section: DeclarationSection) {
  return declared.filter((d) => d.section === section).map((d) => d.name);
}

describe("collectDeclaredElements — reading the registry", () => {
  it("reads ports, adapters, use cases, domain elements and ui components", () => {
    const declared = collectDeclaredElements({
      name: "external-integration",
      layers: {
        domain: {
          entities: ["Snapshot"],
          value_objects: ["ExportIntent"],
        },
        application: {
          use_cases: ["InitiateExportUseCase"],
          ports: {
            in: ["ValidateSpecPort"],
            out: ["RepositoryWriterPort", "PullRequestOpenerPort"],
          },
        },
        infrastructure: { adapters: ["GitHubPullRequestAdapter"] },
        ui: { components: ["ModelSettingsView"] },
      },
    });

    assert.deepEqual(names(declared, "ports.in"), ["ValidateSpecPort"]);
    assert.deepEqual(names(declared, "ports.out"), [
      "RepositoryWriterPort",
      "PullRequestOpenerPort",
    ]);
    assert.deepEqual(names(declared, "adapters"), ["GitHubPullRequestAdapter"]);
    assert.deepEqual(names(declared, "use_cases"), ["InitiateExportUseCase"]);
    assert.deepEqual(names(declared, "entities"), ["Snapshot"]);
    assert.deepEqual(names(declared, "value_objects"), ["ExportIntent"]);
    assert.deepEqual(names(declared, "ui.components"), ["ModelSettingsView"]);
  });

  it("accepts the object port spelling ({ name, owner }) alongside bare strings", () => {
    const declared = collectDeclaredElements({
      name: "shared",
      layers: {
        application: {
          ports: {
            out: [{ name: "LoggerPort", owner: "shared" }, "IntentBusPort"],
          },
        },
      },
    });
    assert.deepEqual(names(declared, "ports.out"), [
      "LoggerPort",
      "IntentBusPort",
    ]);
  });

  it("returns nothing for a context that declares no layers (absent config)", () => {
    assert.deepEqual(collectDeclaredElements({ name: "deployment" }), []);
    assert.deepEqual(
      collectDeclaredElements({ name: "governance", layers: {} }),
      [],
    );
    assert.deepEqual(
      collectDeclaredElements({ name: "ui", layers: { domain: {} } }),
      [],
    );
  });

  it("tolerates malformed shapes instead of throwing", () => {
    const declared = collectDeclaredElements({
      name: "junk",
      layers: {
        application: {
          // A scalar where a mapping belongs, and junk entries in the list.
          ports: { in: "not-a-list", out: [42, null, { owner: "x" }, "  "] },
          use_cases: null,
        },
        infrastructure: "also-not-a-mapping",
      },
    });
    assert.deepEqual(declared, []);
  });

  it("does NOT strip a stray '!' — that entry names no real symbol", () => {
    // A bare `!` is an LLM emission defect (a YAML tag indicator that
    // manifest-violation-fixer repairs). Normalizing it here would turn a real
    // defect into a silent pass.
    const declared = collectDeclaredElements({
      name: "junk",
      layers: { application: { ports: { out: ["!LoggerPort"] } } },
    });
    assert.deepEqual(names(declared, "ports.out"), ["!LoggerPort"]);
  });
});

describe("collectExportedNames — what the code actually exports", () => {
  it("collects every exported declaration kind", () => {
    const file = sourceFile(`
      export interface RepositoryWriterPort { write(): void }
      export type ConfidenceScore = number;
      export class GitHubPullRequestAdapter {}
      export abstract class BaseAdapter {}
      export enum ReportPhase { A }
      export function isNodeKind(v: unknown): boolean { return !!v }
      export const ModelSettingsView = () => null;
      export const FIRST = 1, SECOND = 2;
    `);
    const found = collectExportedNames(file);
    for (const expected of [
      "RepositoryWriterPort",
      "ConfidenceScore",
      "GitHubPullRequestAdapter",
      "BaseAdapter",
      "ReportPhase",
      "isNodeKind",
      "ModelSettingsView",
      "FIRST",
      "SECOND",
    ]) {
      assert.ok(found.includes(expected), `expected to collect ${expected}`);
    }
  });

  it("ignores declarations that are not exported", () => {
    const file = sourceFile(`
      interface InternalPort { x: number }
      class InternalAdapter {}
      const internalValue = 1;
      export interface PublicPort { x: number }
    `);
    const found = collectExportedNames(file);
    assert.deepEqual(found.includes("InternalPort"), false);
    assert.deepEqual(found.includes("InternalAdapter"), false);
    assert.deepEqual(found.includes("internalValue"), false);
    assert.ok(found.includes("PublicPort"));
  });

  it("uses the ALIAS of a renamed re-export — that is the importable name", () => {
    const file = sourceFile(`
      export { LegacyPort as MonacoPersistencePort } from "./legacy.js";
      export { EventBusPort } from "./bus.js";
      export type { IntentBusPort } from "./bus.js";
    `);
    const found = collectExportedNames(file);
    assert.ok(found.includes("MonacoPersistencePort"));
    assert.ok(found.includes("EventBusPort"));
    assert.ok(found.includes("IntentBusPort"));
    // The pre-alias name is NOT exported from here.
    assert.deepEqual(found.includes("LegacyPort"), false);
  });

  it("does not follow `export *` — ownership follows the definition site (ADR-0057 §2)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/other/foreign.ts",
      "export interface ForeignPort { x: number }",
    );
    const barrel = project.createSourceFile(
      "/ctx/src/index.ts",
      'export * from "../../other/foreign.js";',
    );
    assert.deepEqual(collectExportedNames(barrel), []);
  });

  it("does not crash on an anonymous default-exported class", () => {
    const file = sourceFile("export default class {}");
    assert.deepEqual(collectExportedNames(file), []);
  });
});

describe("checkContextDeclarations — accuracy, one direction only", () => {
  const exported = new Set([
    "RepositoryWriterPort",
    "PullRequestOpenerPort",
    "GitHubPullRequestAdapter",
    "GitHubGitDataClient",
    "UndeclaredButRealPort",
  ]);

  it("passes when every declared element names an exported symbol", () => {
    const violations = checkContextDeclarations({
      contextName: "external-integration",
      declared: collectDeclaredElements({
        layers: {
          application: {
            ports: {
              out: ["RepositoryWriterPort", "PullRequestOpenerPort"],
            },
          },
          infrastructure: {
            adapters: ["GitHubPullRequestAdapter", "GitHubGitDataClient"],
          },
        },
      }),
      exportedNames: exported,
    });
    assert.deepEqual(violations, []);
  });

  it("reports NOTHING for a symbol that is exported but not declared", () => {
    // ADR-0057 §1: "An absent entry is not drift and is not a defect."
    const violations = checkContextDeclarations({
      contextName: "external-integration",
      declared: [],
      exportedNames: exported,
    });
    assert.deepEqual(violations, []);
  });

  it("fails a declared port that names no exported symbol", () => {
    const violations = checkContextDeclarations({
      contextName: "external-integration",
      declared: [{ section: "ports.out", name: "GhostPort" }],
      exportedNames: exported,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].enforcement, "error");
    assert.equal(violations[0].specifier, "ports.out:GhostPort");
    assert.match(violations[0].message, /GhostPort/);
    assert.match(violations[0].message, /external-integration/);
  });

  it("fails a declared adapter that names no exported symbol", () => {
    const violations = checkContextDeclarations({
      contextName: "persistence",
      declared: [{ section: "adapters", name: "GhostAdapter" }],
      exportedNames: new Set<string>(),
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].enforcement, "error");
    assert.equal(violations[0].specifier, "adapters:GhostAdapter");
  });

  it("catches a near-miss spelling: RRP declared, ResolvedRuleProgram exported", () => {
    // The real core-domain case. Filename matching would pass this (rrp.ts
    // exists); symbol matching is what makes the rule worth having.
    const violations = checkContextDeclarations({
      contextName: "core-domain",
      declared: [{ section: "value_objects", name: "RRP" }],
      exportedNames: new Set(["ResolvedRuleProgram"]),
      enforcedSections: ["value_objects"],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].enforcement, "error");
  });

  it("reports non-registry sections at warn by default", () => {
    const violations = checkContextDeclarations({
      contextName: "persistence",
      declared: [
        { section: "entities", name: "Snapshot" },
        { section: "use_cases", name: "GhostUseCase" },
        { section: "value_objects", name: "GhostVo" },
        { section: "ui.components", name: "GhostView" },
      ],
      exportedNames: new Set<string>(),
    });
    assert.equal(violations.length, 4);
    assert.deepEqual(
      violations.map((v) => v.enforcement),
      ["warn", "warn", "warn", "warn"],
    );
  });

  it("honours an explicit enforcedSections override", () => {
    const violations = checkContextDeclarations({
      contextName: "persistence",
      declared: [
        { section: "entities", name: "Snapshot" },
        { section: "ports.out", name: "GhostPort" },
      ],
      exportedNames: new Set<string>(),
      enforcedSections: ["entities"],
    });
    const bySection = Object.fromEntries(
      violations.map((v) => [v.section, v.enforcement]),
    );
    assert.equal(bySection["entities"], "error");
    assert.equal(bySection["ports.out"], "warn");
  });

  it("the enforced and advisory section lists do not overlap", () => {
    const enforced = new Set<string>(ENFORCED_DECLARATION_SECTIONS);
    for (const section of ADVISORY_DECLARATION_SECTIONS) {
      assert.deepEqual(
        enforced.has(section),
        false,
        `${section} must not be in both lists`,
      );
    }
  });
});

describe("absent config — a repo that declares nothing cannot fail", () => {
  it("a context with no layers yields no findings even with an empty export set", () => {
    const violations = checkContextDeclarations({
      contextName: "foreign-repo-context",
      declared: collectDeclaredElements({ name: "foreign-repo-context" }),
      exportedNames: new Set<string>(),
    });
    assert.deepEqual(violations, []);
  });
});

describe("contextDeclarationsEnforced — opt-in, absent means OFF", () => {
  it("is off when the project declares no linter config at all", () => {
    assert.equal(contextDeclarationsEnforced(undefined), false);
    assert.equal(contextDeclarationsEnforced({}), false);
  });

  it("is off when the key is present but says nothing", () => {
    assert.equal(
      contextDeclarationsEnforced({ context_declarations: {} }),
      false,
    );
  });

  it("is off when explicitly disabled", () => {
    assert.equal(
      contextDeclarationsEnforced({ context_declarations: { enforce: false } }),
      false,
    );
  });

  it("is on only for a literal true", () => {
    assert.equal(
      contextDeclarationsEnforced({ context_declarations: { enforce: true } }),
      true,
    );
  });

  it("a truthy non-boolean does NOT arm the gate", () => {
    // A hand-edited YAML can yield the STRING "true". Arming a gate on a value
    // the schema never promised is how a rule starts firing where nobody
    // opted in.
    const handEdited = {
      context_declarations: { enforce: "true" },
    } as unknown as { context_declarations?: { enforce?: boolean } };
    assert.equal(contextDeclarationsEnforced(handEdited), false);
  });
});

describe("regression: a GENERATED project must not fail this rule", () => {
  // The capstone `Generate -> gate (minimal-addons)` job caught this. A
  // scaffold's manifest is a SPECIFICATION, not a registry: entries are spelled
  // as FILE NAMES, and `generator.sync.stubs.enabled: false` means the elements
  // they name are deliberately never created. Both break the symbol-matching
  // premise, which is why the rule must be opt-in.
  const generatedContext = {
    name: "ledger",
    layers: {
      application: {
        use_cases: ["RecordEntry"],
        ports: {
          in: ["rest-controller.in-port.ts"],
          out: ["relational-db.out-port.ts"],
        },
      },
      infrastructure: { adapters: ["Prisma.adapter.ts", "BullMQ.adapter.ts"] },
    },
  };

  it("declares elements by filename that no exported symbol will ever match", () => {
    const declared = collectDeclaredElements(generatedContext);
    const names = declared.map((d) => d.name);
    assert.ok(names.includes("Prisma.adapter.ts"));
    assert.ok(names.includes("rest-controller.in-port.ts"));

    // Every one of them WOULD be reported if the rule ran against a scaffold
    // whose stubs were never emitted — which is precisely why it must not run
    // unless a project opted in.
    const wouldFire = checkContextDeclarations({
      contextName: "ledger",
      declared,
      exportedNames: new Set<string>(),
    });
    assert.equal(wouldFire.length, declared.length);
  });

  it("stays silent for such a project, because it opted into nothing", () => {
    assert.equal(contextDeclarationsEnforced(undefined), false);
    assert.equal(contextDeclarationsEnforced({}), false);
  });
});
