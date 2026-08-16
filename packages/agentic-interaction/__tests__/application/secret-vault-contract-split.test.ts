import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "@hexagen/shared";
import { SecureChatDispatchUseCase } from "../../src/application/use-cases/secure-chat-dispatch.use-case";
import type {
  CloudLLMProviderPort,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "../../src/domain/ports/cloud-llm-provider.port";
import type { VaultError, VaultStatus } from "../../src/domain/index";
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
//     `VaultError` whose `kind` the caller must handle, and which
//     `SecureChatDispatchUseCase` propagates instead of dispatching.
//
// Contract (2) has been renamed `ApiKeyVaultLifecyclePort`. These tests pin
// both the split and each side's missing-secret behaviour so a future
// "harmonisation" cannot quietly convert a silent skip into an error or an
// error into a silent skip.
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

function collectSourceFiles(root: string): string[] {
  const found: string[] = [];
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
      found.push(full);
    }
  };
  for (const top of ["packages", "apps", "tools"]) {
    walk(path.join(root, top));
  }
  return found;
}

function declarationSites(files: string[], name: string): string[] {
  const needle = new RegExp(`export\\s+interface\\s+${name}\\b`);
  const sites: string[] = [];
  for (const file of files) {
    if (needle.test(readFileSync(file, "utf8"))) {
      sites.push(path.relative(REPO_ROOT, file));
    }
  }
  return sites.sort();
}

describe("HEX-008: one name, one secret contract", () => {
  const files = collectSourceFiles(REPO_ROOT);

  it("scans a real, non-empty slice of the tree (anti-vacuity control)", () => {
    // Without this the whole suite would pass on a mis-resolved REPO_ROOT: an
    // empty file list makes every "declared exactly once" assertion below
    // trivially satisfiable at zero.
    assert.ok(
      files.length > 200,
      `expected to scan hundreds of source files, scanned ${files.length} under ${REPO_ROOT}`,
    );
    // Positive control: a port that is known to exist, in a *different*
    // package from the one under test, and whose name is deliberately NOT
    // being changed by this item. If the scanner cannot see it, the negative
    // assertions below prove nothing.
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
  });

  it("keeps the two contracts structurally disjoint", () => {
    const envSource = readFileSync(
      path.join(
        REPO_ROOT,
        "packages/agentic-interaction/src/domain/provider-config.ts",
      ),
      "utf8",
    );
    const vaultSource = readFileSync(
      path.join(
        REPO_ROOT,
        "packages/agentic-interaction/src/application/ports/out/api-key-vault-lifecycle.port.ts",
      ),
      "utf8",
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

describe("vault-lifecycle contract: a missing secret is a typed VaultError", () => {
  interface ProviderSpy extends CloudLLMProviderPort {
    calls: CloudLLMCompletionRequest[];
  }

  const createProviderSpy = (): ProviderSpy => {
    const calls: CloudLLMCompletionRequest[] = [];
    return {
      calls,
      async complete(request) {
        calls.push(request);
        return {
          success: true,
          value: { id: "resp-1", model: request.model },
        } satisfies Result<CloudLLMCompletionResponse, Error>;
      },
      async *streamComplete(request) {
        calls.push(request);
        yield { success: true, value: "chunk" } satisfies Result<string, Error>;
      },
    };
  };

  const lockedVault = (error: VaultError): ApiKeyVaultLifecyclePort => ({
    async getStatus() {
      return { success: true, value: { state: "locked" } as VaultStatus };
    },
    async store() {
      return { success: true, value: undefined };
    },
    async retrieve() {
      return { success: false, error };
    },
    async unlock() {
      return { success: true, value: undefined };
    },
    async lock() {
      return { success: true, value: undefined };
    },
    async destroy() {
      return { success: true, value: undefined };
    },
  });

  const unlockedVault = (apiKey: string): ApiKeyVaultLifecyclePort => ({
    ...lockedVault({ kind: "vault_empty", message: "unused" }),
    async retrieve() {
      return { success: true, value: apiKey };
    },
  });

  const request = {
    model: "gpt-4o",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("propagates the exact VaultError kind and never dispatches", async () => {
    const provider = createProviderSpy();
    const useCase = new SecureChatDispatchUseCase(
      lockedVault({ kind: "vault_locked", message: "vault is locked" }),
      provider,
    );

    const result = await useCase.execute(request);

    assert.equal(result.success, false);
    // `kind` is asserted, not just failure: an implementation that collapsed
    // every vault miss into a generic "storage_unavailable" would still be a
    // failure result and would still pass a bare `success === false` check.
    assert.deepEqual(result.success === false ? result.error : null, {
      kind: "vault_locked",
      message: "vault is locked",
    });
    // The security-relevant half: no request may reach the provider when the
    // key could not be retrieved.
    assert.deepEqual(provider.calls, []);
  });

  it("injects the retrieved key exactly once on the happy path", async () => {
    const provider = createProviderSpy();
    const useCase = new SecureChatDispatchUseCase(
      unlockedVault("sk-vaulted"),
      provider,
    );

    const result = await useCase.execute(request);

    assert.equal(result.success, true);
    // Guards the inverse stub: a use case hard-wired to fail would pass the
    // "never dispatches" test above and fail here.
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].apiKey, "sk-vaulted");
    assert.equal(provider.calls[0].model, "gpt-4o");
  });

  it("stops the stream on a vault failure without dispatching", async () => {
    const provider = createProviderSpy();
    const useCase = new SecureChatDispatchUseCase(
      lockedVault({ kind: "vault_empty", message: "no key stored" }),
      provider,
    );

    const chunks: Result<string, VaultError>[] = [];
    for await (const chunk of useCase.streamExecute(request)) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0], {
      success: false,
      error: { kind: "vault_empty", message: "no key stored" },
    });
    assert.deepEqual(provider.calls, []);
  });

  it("streams provider chunks once the vault yields a key", async () => {
    const provider = createProviderSpy();
    const useCase = new SecureChatDispatchUseCase(
      unlockedVault("sk-vaulted"),
      provider,
    );

    const chunks: Result<string, VaultError>[] = [];
    for await (const chunk of useCase.streamExecute(request)) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, [{ success: true, value: "chunk" }]);
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].apiKey, "sk-vaulted");
  });
});
