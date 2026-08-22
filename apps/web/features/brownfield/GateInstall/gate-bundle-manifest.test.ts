/**
 * Drift guard for the S7 bundle listing.
 *
 * The screen mirrors the bundle's file list and the D-B4 `package.json` patch
 * as plain strings rather than importing `@hexagen/project-generation` into a
 * client bundle (see the module comment in `gate-bundle-manifest.ts`). A mirror
 * that nothing checks is a lie waiting to happen, so THIS file is the check: it
 * imports the real BF-6.1 domain module — the same one
 * `app/api/projects/install-gate/route.ts` builds the zip from — and asserts
 * the mirror against it.
 *
 * If BF-6.1 adds a file to the bundle, renames one, reorders them, or bumps the
 * toolchain range, this suite fails and the screen gets corrected. That is the
 * whole point.
 */
import { describe, it, expect } from "vitest";
import {
  HEXAGEN_GATE_INSTALL_DOC,
  HEXAGEN_GATE_INSTALL_DOC_PATH,
  HEXAGEN_TOOLCHAIN_RANGE,
  hexagenGateBundleFiles,
} from "@hexagen/project-generation";

import {
  GATE_BUNDLE_ENTRIES,
  GATE_CHECK_SCRIPT_COMMAND,
  GATE_CHECK_SCRIPT_NAME,
  GATE_INSTALL_ROUTE_MODE,
  GATE_LINT_SCRIPT_COMMAND,
  GATE_LINT_SCRIPT_NAME,
  GATE_PACKAGE_JSON_PATCH,
  GATE_PACKAGE_MANAGER_PIN,
  GATE_TOOLCHAIN_PACKAGES,
  GATE_TOOLCHAIN_RANGE,
  INSTALL_GATE_ENDPOINT,
  gateBundleFileName,
  isInstallableScanId,
} from "./gate-bundle-manifest";

describe("GATE_BUNDLE_ENTRIES mirrors hexagenGateBundleFiles()", () => {
  it("lists exactly the bundle's paths, in the bundle's order", () => {
    expect(GATE_BUNDLE_ENTRIES.map((entry) => entry.path)).toEqual(
      hexagenGateBundleFiles().map((file) => file.path),
    );
  });

  it("gives every file a non-empty purpose line", () => {
    for (const entry of GATE_BUNDLE_ENTRIES) {
      expect(entry.purpose.trim().length).toBeGreaterThan(0);
    }
  });

  it("ends with the D-B4 install doc, which is what makes the no-patch story legible", () => {
    const last = GATE_BUNDLE_ENTRIES[GATE_BUNDLE_ENTRIES.length - 1];
    expect(last.path).toBe(HEXAGEN_GATE_INSTALL_DOC_PATH);
  });

  it("names every bundled file somewhere in the shipped install doc", () => {
    // Cross-check in the other direction: the doc's contents table and the
    // screen's list are two descriptions of one zip, written by two packets.
    for (const entry of GATE_BUNDLE_ENTRIES) {
      expect(HEXAGEN_GATE_INSTALL_DOC).toContain(entry.path);
    }
  });
});

describe("GATE_PACKAGE_JSON_PATCH (decision D-B4)", () => {
  it("is valid JSON a user can merge by hand", () => {
    expect(() => JSON.parse(GATE_PACKAGE_JSON_PATCH)).not.toThrow();
  });

  it("carries the packageManager pin, both scripts and both toolchain packages", () => {
    const parsed = JSON.parse(GATE_PACKAGE_JSON_PATCH) as {
      packageManager: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(parsed.packageManager).toBe(GATE_PACKAGE_MANAGER_PIN);
    expect(parsed.scripts[GATE_LINT_SCRIPT_NAME]).toBe(
      GATE_LINT_SCRIPT_COMMAND,
    );
    expect(parsed.scripts[GATE_CHECK_SCRIPT_NAME]).toBe(
      GATE_CHECK_SCRIPT_COMMAND,
    );
    for (const pkg of GATE_TOOLCHAIN_PACKAGES) {
      expect(parsed.devDependencies[pkg]).toBe(GATE_TOOLCHAIN_RANGE);
    }
  });

  it("agrees with the range the shipped doc tells consumers to install", () => {
    expect(GATE_TOOLCHAIN_RANGE).toBe(HEXAGEN_TOOLCHAIN_RANGE);
  });

  it("reproduces every key/value fragment the shipped doc asks for", () => {
    // Fragment-wise rather than whole-block: the doc splits the same edits over
    // three fenced snippets (2a/2b/2c) and the screen merges them into one
    // copyable object. The VALUES have to match; the shape does not.
    const fragments = [
      `"packageManager": "${GATE_PACKAGE_MANAGER_PIN}"`,
      `"${GATE_LINT_SCRIPT_NAME}": "${GATE_LINT_SCRIPT_COMMAND}"`,
      `"${GATE_CHECK_SCRIPT_NAME}": "${GATE_CHECK_SCRIPT_COMMAND}"`,
      ...GATE_TOOLCHAIN_PACKAGES.map(
        (pkg) => `"${pkg}": "${GATE_TOOLCHAIN_RANGE}"`,
      ),
    ];

    for (const fragment of fragments) {
      expect(GATE_PACKAGE_JSON_PATCH).toContain(fragment);
      expect(HEXAGEN_GATE_INSTALL_DOC).toContain(fragment);
    }
  });
});

describe("wire vocabulary", () => {
  it("targets BF-6.1's route", () => {
    expect(INSTALL_GATE_ENDPOINT).toBe("/api/projects/install-gate");
  });

  it("maps both flow modes onto the route's shorter mode names", () => {
    expect(GATE_INSTALL_ROUTE_MODE).toEqual({
      "download-zip": "zip",
      "open-pr": "pr",
    });
  });
});

describe("gateBundleFileName", () => {
  it("matches the Content-Disposition the route sends", () => {
    expect(gateBundleFileName("scan-42")).toBe("hexagen-gate-scan-42.zip");
  });
});

describe("isInstallableScanId", () => {
  it("accepts the id shapes this app mints", () => {
    expect(isInstallableScanId("scan-42")).toBe(true);
    expect(isInstallableScanId("a.b_c-D9")).toBe(true);
  });

  it("rejects what the route rejects — empty, traversal, header injection, overlong", () => {
    expect(isInstallableScanId("")).toBe(false);
    expect(isInstallableScanId("../etc/passwd")).toBe(false);
    expect(isInstallableScanId('a"; filename="b')).toBe(false);
    expect(isInstallableScanId("a\r\nX-Injected: 1")).toBe(false);
    expect(isInstallableScanId("a".repeat(65))).toBe(false);
  });

  it("accepts exactly 64 characters — the route's own boundary", () => {
    expect(isInstallableScanId("a".repeat(64))).toBe(true);
  });
});
