import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ADR-0048 guard — port direction is a structural invariant, not a habit.
 *
 * Rule of thumb from ADR-0048 Decision 1: "if an infrastructure adapter
 * `implements` the interface, it is an outbound port and belongs in
 * `ports/out`." This guard mechanises exactly that sentence for
 * @hexagen/governance: every interface an infrastructure adapter implements
 * must be imported from `application/ports/out/`.
 *
 * It is deliberately source-text based rather than type-based: the defect it
 * guards against (a driven port filed under `ports/in`) is invisible to the
 * type checker, since both directories type-check identically.
 */

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const INFRASTRUCTURE_ROOT = path.join(SRC_ROOT, "infrastructure");

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTypeScriptFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }

  return found;
}

interface ImplementedContract {
  /** Path of the adapter file, relative to `src/`. */
  readonly adapter: string;
  /** Interface name appearing after `implements`. */
  readonly contract: string;
  /** Module specifier the interface was imported from, if resolvable. */
  readonly specifier: string | undefined;
}

interface PortDirectionFindings {
  readonly misfiled: readonly ImplementedContract[];
  readonly unresolved: readonly ImplementedContract[];
}

/**
 * Extract `class X ... implements A, B` pairs and the specifier each contract
 * name was imported from in that same file.
 */
function extractImplementedContracts(
  relativePath: string,
  source: string,
): ImplementedContract[] {
  const contracts: ImplementedContract[] = [];
  const implementsPattern = /\bclass\s+\w+[^{]*?\bimplements\s+([^{]+)\{/g;

  for (const match of source.matchAll(implementsPattern)) {
    const names = match[1]
      .split(",")
      .map((name) => name.trim().replace(/<.*$/, ""))
      .filter((name) => name.length > 0);

    for (const contract of names) {
      contracts.push({
        adapter: relativePath,
        contract,
        specifier: findImportSpecifier(source, contract),
      });
    }
  }

  return contracts;
}

/**
 * Resolve `implements Foo` / `implements Ns.Foo` back to an import specifier.
 *
 * Covers the TypeScript forms a port contract can legally arrive as:
 * named, inline `type`, default, namespace, and mixed default+named
 * (`import type` included). `implements Ns.Contract` resolves `Ns`.
 *
 * Fail-closed: if this returns undefined the scan treats the contract as a
 * violation rather than skipping it. A named-only matcher plus
 * `specifier?.startsWith(".")` would let a second adapter hide a misfiled
 * port behind an unresolved form while the first adapter still satisfied
 * the anti-vacuity check.
 */
function findImportSpecifier(
  source: string,
  contract: string,
): string | undefined {
  const identifier = contract.split(".")[0] ?? contract;
  const importPattern =
    /import\s+(?:type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) {
    const clause = match[1] ?? "";
    const specifier = match[2];
    if (specifier !== undefined && clauseBindsIdentifier(clause, identifier)) {
      return specifier;
    }
  }

  return undefined;
}

function clauseBindsIdentifier(clause: string, identifier: string): boolean {
  for (const ns of clause.matchAll(/\*\s+as\s+(\w+)/g)) {
    if (ns[1] === identifier) {
      return true;
    }
  }

  const named = /\{([^}]*)\}/.exec(clause);
  if (named?.[1] !== undefined) {
    const imported = named[1]
      .split(",")
      .map((name) =>
        name
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()
          ?.trim(),
      )
      .filter((name): name is string => Boolean(name));
    if (imported.includes(identifier)) {
      return true;
    }
  }

  const trimmed = clause.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("*")) {
    return false;
  }
  return /^(\w+)/.exec(trimmed)?.[1] === identifier;
}

function classifyPortDirection(
  contracts: readonly ImplementedContract[],
): PortDirectionFindings {
  return {
    misfiled: contracts.filter(
      ({ specifier }) =>
        specifier !== undefined && specifier.includes("/ports/in/"),
    ),
    unresolved: contracts.filter(({ specifier }) => specifier === undefined),
  };
}

describe("ADR-0048 port direction (governance)", () => {
  it("imports every adapter-implemented contract from application/ports/out", async () => {
    const files = await collectTypeScriptFiles(INFRASTRUCTURE_ROOT);
    const contracts = files.length
      ? (
          await Promise.all(
            files.map(async (file) =>
              extractImplementedContracts(
                path.relative(SRC_ROOT, file),
                await readFile(file, "utf8"),
              ),
            ),
          )
        ).flat()
      : [];

    // Anti-vacuity: if the scan finds nothing to check, the assertions below
    // would pass over an empty list and report confidence they have not
    // earned. governance has at least one adapter implementing a port.
    expect(
      contracts.length,
      "expected at least one `implements` pair under src/infrastructure — " +
        "a guard that checks nothing is worse than no guard",
    ).toBeGreaterThan(0);

    const { misfiled, unresolved } = classifyPortDirection(contracts);

    expect(
      unresolved.map((c) => `${c.adapter} implements ${c.contract}`),
      "could not resolve the import for this implemented contract — import " +
        "it from application/ports/out so the ADR-0048 guard can check it. " +
        "Unresolved package-local contracts are failures, not skips.",
    ).toEqual([]);

    expect(
      misfiled.map(
        (c) => `${c.adapter} implements ${c.contract} from ${c.specifier}`,
      ),
      "an infrastructure adapter implements this contract, so per ADR-0048 " +
        "it is a driven port and belongs in application/ports/out",
    ).toEqual([]);

    // Every locally-declared contract must resolve into ports/out. Contracts
    // imported from another package (e.g. @hexagen/shared) are out of scope
    // for this package's own directory convention.
    const localContracts = contracts.filter(({ specifier }) =>
      specifier?.startsWith("."),
    );

    expect(
      localContracts.length,
      "expected at least one package-local implemented contract",
    ).toBeGreaterThan(0);

    for (const { adapter, contract, specifier } of localContracts) {
      expect(
        specifier,
        `${adapter} implements ${contract}; ADR-0048 files driven ports under application/ports/out`,
      ).toContain("/application/ports/out/");
    }
  });

  it("resolves non-named import forms and fails closed on unresolved contracts", () => {
    // String-source fixtures: the live scan only sees today's named-type
    // import on OpenPolicyAdapter. These pin the forms a later adapter
    // (or the `export *` barrel) can legally use, including the
    // previously-skipped namespace / mixed / default paths.
    const fixtures: ReadonlyArray<{
      readonly label: string;
      readonly source: string;
      readonly contract: string;
      readonly specifier: string | undefined;
      readonly misfiled: boolean;
      readonly unresolved: boolean;
    }> = [
      {
        label: "namespace import from ports/in",
        source: `
          import type * as Ports from "../../application/ports/in/policy-evaluator.port.js";
          export class BadAdapter implements Ports.IPolicyEvaluator {}
        `,
        contract: "Ports.IPolicyEvaluator",
        specifier: "../../application/ports/in/policy-evaluator.port.js",
        misfiled: true,
        unresolved: false,
      },
      {
        label: "default import from ports/in",
        source: `
          import type IPolicyEvaluator from "../../application/ports/in/policy-evaluator.port.js";
          export class BadAdapter implements IPolicyEvaluator {}
        `,
        contract: "IPolicyEvaluator",
        specifier: "../../application/ports/in/policy-evaluator.port.js",
        misfiled: true,
        unresolved: false,
      },
      {
        label: "mixed default+named import from ports/in",
        source: `
          import Base, { IPolicyEvaluator } from "../../application/ports/in/policy-evaluator.port.js";
          export class BadAdapter implements IPolicyEvaluator {}
        `,
        contract: "IPolicyEvaluator",
        specifier: "../../application/ports/in/policy-evaluator.port.js",
        misfiled: true,
        unresolved: false,
      },
      {
        label: "inline type named import from ports/in",
        source: `
          import { type IPolicyEvaluator } from "../../application/ports/in/policy-evaluator.port.js";
          export class BadAdapter implements IPolicyEvaluator {}
        `,
        contract: "IPolicyEvaluator",
        specifier: "../../application/ports/in/policy-evaluator.port.js",
        misfiled: true,
        unresolved: false,
      },
      {
        label: "implemented contract with no import",
        source: `
          export class BadAdapter implements IUnimportedPort {}
        `,
        contract: "IUnimportedPort",
        specifier: undefined,
        misfiled: false,
        unresolved: true,
      },
    ];

    for (const fixture of fixtures) {
      const contracts = extractImplementedContracts(
        "infrastructure/adapters/fixture.adapter.ts",
        fixture.source,
      );
      expect(
        contracts,
        `${fixture.label}: expected one implements pair`,
      ).toHaveLength(1);
      expect(contracts[0]?.contract, fixture.label).toBe(fixture.contract);
      expect(contracts[0]?.specifier, fixture.label).toBe(fixture.specifier);

      const findings = classifyPortDirection(contracts);
      expect(findings.misfiled.length > 0, fixture.label).toBe(
        fixture.misfiled,
      );
      expect(findings.unresolved.length > 0, fixture.label).toBe(
        fixture.unresolved,
      );
    }
  });
});
