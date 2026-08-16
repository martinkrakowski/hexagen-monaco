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

function findImportSpecifier(
  source: string,
  contract: string,
): string | undefined {
  const importPattern =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) {
    const imported = match[1]
      .split(",")
      .map((name) =>
        name
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim(),
      )
      .filter((name): name is string => Boolean(name));

    if (imported.includes(contract)) {
      return match[2];
    }
  }

  return undefined;
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

    const misfiled = contracts.filter(
      ({ specifier }) =>
        specifier !== undefined && specifier.includes("/ports/in/"),
    );

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
});
