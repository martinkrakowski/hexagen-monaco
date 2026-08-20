import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiKeyVaultLifecyclePort } from "../../src/application/ports/index";
import {
  resolveApiKey,
  resolveFallbackChain,
  type SecretVaultPort,
  type CloudProviderEndpoint,
} from "../../src/domain/provider-config";
import { EnvironmentSecretVaultAdapter } from "../../src/infrastructure/adapters/environment-secret-vault.adapter";

// ---------------------------------------------------------------------------
// HEX-008 / remediation item 5.4.
//
// `SecretVaultPort` used to name TWO structurally disjoint contracts inside
// `@hexagen/agentic-interaction`:
//
//   1. domain `SecretVaultPort`          — synchronous env-var lookup,
//                                          `getSecret(name): string | null`
//   2. application `SecretVaultPort`     — a stored-API-key vault lifecycle,
//                                          `getStatus/store/retrieve/unlock/
//                                          lock/destroy` over `Result<_, VaultError>`
//
// They disagree about a *missing or empty* secret, and that disagreement is
// deliberate, not incidental:
//
//   * the env-lookup contract treats "absent" as a NON-ERROR — `null`, which
//     `resolveApiKey` turns into "this provider is not configured" and
//     `resolveFallbackChain` silently skips. Nothing throws, nothing surfaces.
//   * the vault-lifecycle contract treats "absent" as a TYPED FAILURE — a
//     `VaultError` whose `kind` the caller must handle.
//
// Contract (2) has been renamed `ApiKeyVaultLifecyclePort`. These tests pin
// the split and the env-lookup side's missing-secret behaviour so a future
// "harmonisation" cannot quietly convert a silent skip into an error or an
// error into a silent skip. The lifecycle port stays declared; HEX-008 is
// not closed by deleting an unused use case that once consumed it.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

const SKIP_DIRS = new Set([
  ".git",
  ".claude",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  // Generated scaffolds ship their own port declarations by design; the
  // homonym doctrine (ADR-0047) governs real source, not emitted templates.
  "templates",
]);

const SCANNED_ROOTS = ["packages", "apps", "tools"] as const;

/**
 * Repo-relative path with forward slashes on every platform.
 *
 * `path.relative` and `path.join` emit the host separator, so on Windows the
 * raw value is backslash-separated. Every path this suite asserts against —
 * and the `.sort()` that orders them — is POSIX-shaped, so normalisation has
 * to happen here, at the single boundary where an OS path becomes a compared
 * value, rather than at each call site.
 */
const toRepoRelative = (absolute: string): string =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

interface SourceFile {
  /** Repo-relative, forward-slash separated. */
  readonly path: string;
  readonly text: string;
}

/**
 * Walks the workspace once and reads each file once. The uniqueness questions
 * below are asked of three different interface names; re-walking and re-reading
 * per question triples the I/O for an answer that cannot change mid-suite.
 */
function collectSourceFiles(root: string): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
        continue;
      found.push({
        path: toRepoRelative(full),
        text: readFileSync(full, "utf8"),
      });
    }
  };
  for (const top of SCANNED_ROOTS) {
    walk(path.join(root, top));
  }
  return found;
}

function declarationSites(
  files: readonly SourceFile[],
  name: string,
): string[] {
  const needle = new RegExp(`export\\s+interface\\s+${name}\\b`);
  return files
    .filter((file) => needle.test(file.text))
    .map((file) => file.path)
    .sort();
}

describe("HEX-008: one name, one secret contract", () => {
  const files = collectSourceFiles(REPO_ROOT);

  it("scans a real, non-empty slice of the tree (anti-vacuity control)", () => {
    // Without an anti-vacuity control the whole suite would pass on a
    // mis-resolved REPO_ROOT: an empty file list makes every "declared
    // exactly once" assertion below trivially satisfiable at zero.
    //
    // The control anchors on things that MUST be true rather than on a file
    // count. A count is not a property of the split — a re-org, a sparse or
    // filtered checkout, or a new SKIP_DIRS entry can move it without
    // weakening a single assertion, and no value of it proves the walk
    // reached the right tree.
    const scanned = new Set(files.map((file) => file.path));

    // (a) Named files that MUST be in the scan, one per workspace tree the
    // uniqueness claim ranges over. Anchoring on files rather than on tree
    // names is what makes this bite: a check that merely iterates
    // SCANNED_ROOTS shrinks along with the constant, so deleting "tools" from
    // it would still pass. These do not.
    //
    // Each anchor is a file this suite's conclusions already depend on — a
    // declaration site it asserts about, or a consumer whose binding the split
    // exists to protect — so none of them is a new free-floating constant.
    for (const anchor of [
      // packages/ — the two declaration sites asserted below, plus the
      // cross-package positive control.
      "packages/agentic-interaction/src/domain/provider-config.ts",
      "packages/agentic-interaction/src/application/ports/out/api-key-vault-lifecycle.port.ts",
      "packages/web-driver/src/application/ports/user-secret-vault.port.ts",
      // apps/ — the two consumers that bind a vault contract. The .tsx one
      // also proves the walk's .tsx arm works: a homonym could hide there.
      "apps/web/app/lib/vault-context.tsx",
      "apps/tui/src/services/action-service.ts",
      // tools/ — the linter's entry source; the tree is small, but a homonym
      // declared in it would be just as much a collision.
      "tools/arch-linter/src/index.ts",
    ]) {
      assert.ok(
        scanned.has(anchor),
        `scan did not reach ${anchor} under ${REPO_ROOT}; the workspace-wide uniqueness assertions below do not cover its tree`,
      );
    }

    // (b) Positive control on the *matcher*, not just the walk: a port that is
    // known to exist, in a different package from the one under test, and
    // whose name is deliberately NOT being changed by this item. If the
    // matcher cannot see it, the negative assertions below prove nothing.
    assert.deepEqual(declarationSites(files, "UserSecretVaultPort"), [
      "packages/web-driver/src/application/ports/user-secret-vault.port.ts",
    ]);
  });

  it("declares SecretVaultPort exactly once, and only as the env-var lookup", () => {
    assert.deepEqual(declarationSites(files, "SecretVaultPort"), [
      "packages/agentic-interaction/src/domain/provider-config.ts",
    ]);
  });

  it("declares the vault-lifecycle contract under its own name", () => {
    assert.deepEqual(declarationSites(files, "ApiKeyVaultLifecyclePort"), [
      "packages/agentic-interaction/src/application/ports/out/api-key-vault-lifecycle.port.ts",
    ]);
    // Type-level pin: dropping the port from the application barrel fails
    // typecheck:test. `retrieve` is the absent-secret seam (typed VaultError).
    const retrieve: keyof ApiKeyVaultLifecyclePort = "retrieve";
    assert.equal(retrieve, "retrieve");
  });

  it("keeps the two contracts structurally disjoint", () => {
    const sourceOf = (repoRelativePath: string): string => {
      const file = files.find(
        (candidate) => candidate.path === repoRelativePath,
      );
      assert.ok(file, `expected the scan to have read ${repoRelativePath}`);
      return file.text;
    };
    const envSource = sourceOf(
      "packages/agentic-interaction/src/domain/provider-config.ts",
    );
    const vaultSource = sourceOf(
      "packages/agentic-interaction/src/application/ports/out/api-key-vault-lifecycle.port.ts",
    );
    // The env-lookup contract must not grow the vault lifecycle, and the
    // vault must not grow a synchronous env read — that overlap is what would
    // let a consumer bind the wrong adapter again.
    for (const method of ["store(", "unlock(", "lock(", "destroy("]) {
      assert.ok(
        !envSource.includes(method),
        `env-lookup contract must not declare ${method}`,
      );
    }
    assert.ok(
      !vaultSource.includes("getSecret("),
      "vault-lifecycle contract must not declare getSecret(",
    );
  });
});

describe("env-var lookup contract: a missing secret is an omission, not an error", () => {
  const ENV_VAR = "HEX008_TEST_KEY";
  const endpoint: CloudProviderEndpoint = {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvVar: ENV_VAR,
  };

  const withEnv = (value: string | undefined, run: () => void): void => {
    const original = process.env[ENV_VAR];
    if (value === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = value;
    try {
      run();
    } finally {
      if (original === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = original;
    }
  };

  it("EnvironmentSecretVaultAdapter maps unset, empty and whitespace-only to null", () => {
    const adapter = new EnvironmentSecretVaultAdapter();
    withEnv(undefined, () => assert.equal(adapter.getSecret(ENV_VAR), null));
    withEnv("", () => assert.equal(adapter.getSecret(ENV_VAR), null));
    withEnv("   \t ", () => assert.equal(adapter.getSecret(ENV_VAR), null));
    // ...and does NOT trim a real key: the stored value is returned verbatim.
    withEnv(" sk-live ", () =>
      assert.equal(adapter.getSecret(ENV_VAR), " sk-live "),
    );
  });

  it("resolveApiKey rejects a blank secret even when the vault hands one back", () => {
    // Defence in depth. A vault that is not EnvironmentSecretVaultAdapter may
    // return "" rather than null; `resolveApiKey` must still refuse. A
    // reimplementation that merely forwards `vault.getSecret(...)` — the
    // obvious stub — passes the null cases above and fails right here.
    const blankVault: SecretVaultPort = { getSecret: () => "   " };
    assert.equal(resolveApiKey(blankVault, endpoint), null);

    const emptyVault: SecretVaultPort = { getSecret: () => "" };
    assert.equal(resolveApiKey(emptyVault, endpoint), null);

    const liveVault: SecretVaultPort = { getSecret: () => "sk-live" };
    assert.deepEqual(resolveApiKey(liveVault, endpoint), {
      ...endpoint,
      apiKey: "sk-live",
    });
  });

  it("resolveFallbackChain silently drops unconfigured providers instead of failing", () => {
    const asked: string[] = [];
    const vault: SecretVaultPort = {
      getSecret: (name) => {
        asked.push(name);
        return name === "HEX008_SECOND" ? "sk-second" : null;
      },
    };
    const resolved = resolveFallbackChain(vault, {
      primary: { ...endpoint, apiKeyEnvVar: "HEX008_FIRST" },
      fallbacks: [
        { ...endpoint, apiKeyEnvVar: "HEX008_SECOND" },
        { ...endpoint, apiKeyEnvVar: "HEX008_THIRD" },
      ],
    });

    // Every candidate is consulted — a short-circuit on the first miss would
    // change which providers are reachable.
    assert.deepEqual(asked, ["HEX008_FIRST", "HEX008_SECOND", "HEX008_THIRD"]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].apiKey, "sk-second");
    assert.equal(resolved[0].apiKeyEnvVar, "HEX008_SECOND");
  });
});
