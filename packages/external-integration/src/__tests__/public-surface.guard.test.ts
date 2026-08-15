import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as publicApi from "../index.js";

/**
 * Guard for the AUD-008 / AUD-009 deletion (architecture-remediation item 4.4).
 *
 * The external-integration context declared a fictional auth hexagon (3
 * use-cases, 3 inbound ports, 2 driven ports, 3 domain VOs) plus a broken
 * `GitHubVcsAdapter` (the sole `@octokit/rest` user), all validated as "live"
 * by the governance manifest despite having zero adapters and zero consumers.
 * Real GitHub auth is NextAuth in apps/web (ADR-0046).
 *
 * This test asserts those runtime-value symbols are gone from the package's
 * PUBLIC barrel, and — as a live-surface anchor so the guard cannot pass merely
 * because the module failed to load — that the genuinely-live infrastructure
 * capabilities (scaffold export + editor push) are still exported.
 *
 * Note: interface/type-only symbols (`IVersionControlSystem`, `OAuthProviderPort`,
 * the inbound ports, `SessionReadPort`) have no runtime footprint, so they are
 * covered structurally by deleting their source files + barrel entries; only
 * runtime-value exports (classes, consts, factory fns) are assertable here.
 */
describe("external-integration public surface (AUD-008 / AUD-009 guard)", () => {
  const surface = publicApi as Record<string, unknown>;

  const removedRuntimeExports = [
    // AUD-009: the broken PR adapter (sole @octokit/rest user).
    "GitHubVcsAdapter",
    // AUD-008: dead auth use-case classes.
    "InitiateAuthUseCase",
    "GetAuthSessionUseCase",
    "RevokeAuthUseCase",
    // AUD-008: dead auth domain VO runtime values (factories / consts).
    "createAuthSession",
    "isSessionExpired",
    "isSessionValid",
    "createProviderIdentity",
    "GITHUB_PROVIDER",
    "isGitHubProvider",
  ];

  for (const name of removedRuntimeExports) {
    it(`no longer exports ${name}`, () => {
      assert.ok(
        !(name in surface),
        `${name} is dead code (AUD-008/AUD-009) and must not be re-exported from the public barrel`,
      );
    });
  }

  // Live-surface anchor: proves the module actually loaded (a whole-module
  // load failure would fail HERE too, so the "not exported" assertions above
  // can't pass vacuously).
  const liveExports = [
    "GitHubExporterAdapter", // scaffold export -> /api/export/github
    "GitHubRepositoryWriterAdapter", // editor push  -> /api/push/github
    "GitHubGitDataClient", // shared low-level Git Data client
    "GitHubApiError", // typed failure class threaded through the ports
  ];

  for (const name of liveExports) {
    it(`still exports the live capability ${name}`, () => {
      assert.equal(
        typeof surface[name],
        "function",
        `${name} is a live capability and must remain exported from the public barrel`,
      );
    });
  }
});
