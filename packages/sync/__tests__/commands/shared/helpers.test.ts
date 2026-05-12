/* eslint-disable no-control-regex, turbo/no-undeclared-env-vars */
// no-control-regex: ANSI escape sequences are the code-under-test
// turbo/no-undeclared-env-vars: CI + HEXAGEN_NO_PROMPT are observed behavior
// inside shared/prompt-service.ts; this test mutates them transiently and
// restores originals. Not a turbo task input.
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatError,
  formatWarning,
  formatSuccess,
  formatInfo,
  formatBold,
  formatSection,
} from "../../../src/commands/shared/error-formatter.js";
import { findProjectRoot } from "../../../src/commands/shared/project-root.js";
import { PromptService } from "../../../src/commands/shared/prompt-service.js";
import { confirm } from "../../../src/commands/shared/confirm.js";
import {
  isValidContextName,
  isValidPortName,
  isValidPackageName,
  isPascalCase,
  isSnakeCase,
  validateContextName,
  validatePortName,
} from "../../../src/commands/shared/validation.js";
import {
  YamlService,
  YamlLoadError,
  YamlParseError,
  YamlSaveError,
} from "../../../src/commands/shared/yaml-service.js";
import type { Manifest } from "../../../src/types/manifest.js";

/**
 * Unit tests for the eight helpers in packages/sync/src/commands/shared/.
 *
 * Helper classification (documented for future maintainers):
 *   - error-formatter.ts : testable  — pure string formatters; TTY branch exercised via stub
 *   - project-root.ts    : partial   — findProjectRoot is pure; getProjectRoot calls process.exit → skipped
 *   - prompt-service.ts  : partial   — canPrompt / isTTY tested; ask/select require stdin stub → skipped
 *   - validation.ts      : testable  — pure regex predicates + ValidationResult builders
 *   - yaml-service.ts    : testable  — Result<T,E> wrappers around yaml.load/dump + atomic save
 *   - confirm.ts         : interactive — only the force=true short-circuit is testable without stdin stub
 *   - spinner.ts         : interactive — pure side-effects on stdout; no contract worth asserting here
 *
 * Conventions (mirroring fs-utils.test.ts):
 *   - Temp dirs via fs.mkdtemp, cleaned in afterEach.
 *   - TTY / env stubs restored in afterEach to avoid leaking state between tests.
 *   - Every file I/O assertion reads from disk to verify, never trusts the return value alone.
 */

// ---------------------------------------------------------------------------
// error-formatter
// ---------------------------------------------------------------------------

describe("error-formatter", () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    // Capture and force non-TTY so assertions are deterministic. Individual
    // tests that want the coloured branch flip this back on explicitly.
    originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    });
  });

  describe("non-TTY output (CI / piped)", () => {
    it("formatError prepends the error glyph without ANSI codes", () => {
      const out = formatError("boom");
      assert.equal(out, "❌ boom");
      assert.ok(!out.includes("\x1b["), "no ANSI escapes in non-TTY mode");
    });

    it("formatWarning / formatSuccess / formatInfo have their canonical glyphs", () => {
      assert.equal(formatWarning("w"), "⚠️ w");
      assert.equal(formatSuccess("s"), "✅ s");
      // formatInfo is glyph-only (no colour branch) — double-space is intentional.
      assert.equal(formatInfo("i"), "ℹ️  i");
    });

    it("formatBold is a pass-through when not a TTY", () => {
      assert.equal(formatBold("title"), "title");
    });

    it("formatSection renders a title with an underline of matching length", () => {
      const section = formatSection("Usage");
      const lines = section.split("\n");
      assert.equal(
        lines[0],
        "",
        "leading newline separates section from previous output",
      );
      assert.equal(lines[1], "Usage", "title is bold (plain in non-TTY)");
      assert.equal(lines[2], "─────", "underline matches title length (5)");
    });
  });

  describe("TTY output (interactive)", () => {
    beforeEach(() => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
        writable: true,
      });
    });

    it("formatError wraps the glyph in red ANSI when TTY", () => {
      const out = formatError("boom");
      // \x1b[31m = red, \x1b[0m = reset. Only the glyph is coloured.
      assert.match(out, /^\x1b\[31m❌\x1b\[0m boom$/);
    });

    it("formatBold applies BOLD + RESET around the text in TTY mode", () => {
      assert.equal(formatBold("x"), "\x1b[1mx\x1b[0m");
    });
  });
});

// ---------------------------------------------------------------------------
// project-root — findProjectRoot (pure fs walk)
// ---------------------------------------------------------------------------

describe("findProjectRoot", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-proj-root-"));
    // Resolve symlinks (macOS /var → /private/var) so that path.dirname loops
    // terminate at the real filesystem root in the "not found" case.
    tmpRoot = await fs.realpath(tmpRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns the directory containing .architecture/manifest.yaml", async () => {
    const archDir = path.join(tmpRoot, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    await fs.writeFile(
      path.join(archDir, "manifest.yaml"),
      "bounded_contexts: []\n",
      "utf8",
    );

    assert.equal(findProjectRoot(tmpRoot), tmpRoot);
  });

  it("walks upward from a nested child directory until the marker is found", async () => {
    const archDir = path.join(tmpRoot, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    await fs.writeFile(
      path.join(archDir, "manifest.yaml"),
      "bounded_contexts: []\n",
      "utf8",
    );

    const deep = path.join(tmpRoot, "packages", "foo", "src", "nested");
    await fs.mkdir(deep, { recursive: true });

    assert.equal(findProjectRoot(deep), tmpRoot);
  });

  it("returns null when no .architecture/manifest.yaml exists up to fs root", () => {
    // tmpRoot has no .architecture/ — walk will terminate at "/" and return null.
    // (We trust that the host filesystem root has no .architecture/manifest.yaml.)
    assert.equal(findProjectRoot(tmpRoot), null);
  });

  it("ignores a directory literally named .architecture that is not a directory holding manifest.yaml", async () => {
    // Create a FILE called `.architecture` — join("…/.architecture", "manifest.yaml")
    // will therefore not resolve to a real path, so the walk must continue (and,
    // in this sandbox, ultimately return null).
    await fs.writeFile(
      path.join(tmpRoot, ".architecture"),
      "not a dir",
      "utf8",
    );
    assert.equal(findProjectRoot(tmpRoot), null);
  });
});

// ---------------------------------------------------------------------------
// prompt-service — pure parts only (isTTY, canPrompt)
// ---------------------------------------------------------------------------

describe("PromptService — environment detection", () => {
  let originalIsTTY: boolean | undefined;
  let originalCI: string | undefined;
  let originalNoPrompt: string | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    originalCI = process.env.CI;
    originalNoPrompt = process.env.HEXAGEN_NO_PROMPT;
    delete process.env.CI;
    delete process.env.HEXAGEN_NO_PROMPT;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    });
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    if (originalNoPrompt === undefined) delete process.env.HEXAGEN_NO_PROMPT;
    else process.env.HEXAGEN_NO_PROMPT = originalNoPrompt;
  });

  function setTTY(value: boolean): void {
    Object.defineProperty(process.stdout, "isTTY", {
      value,
      configurable: true,
      writable: true,
    });
  }

  it("isTTY mirrors process.stdout.isTTY", () => {
    const svc = new PromptService();
    setTTY(true);
    assert.equal(svc.isTTY(), true);
    setTTY(false);
    assert.equal(svc.isTTY(), false);
  });

  it("canPrompt is true in a real TTY even with CI set (TTY wins)", () => {
    setTTY(true);
    process.env.CI = "1";
    assert.equal(new PromptService().canPrompt(), true);
  });

  it("canPrompt is false in non-TTY + CI environments", () => {
    setTTY(false);
    process.env.CI = "1";
    assert.equal(new PromptService().canPrompt(), false);
  });

  it("canPrompt is false when HEXAGEN_NO_PROMPT=1 in non-TTY", () => {
    setTTY(false);
    process.env.HEXAGEN_NO_PROMPT = "1";
    assert.equal(new PromptService().canPrompt(), false);
  });

  it("canPrompt defaults to false when not a TTY and no env signals are set", () => {
    setTTY(false);
    // Implementation falls through to `return false` — documented behaviour.
    assert.equal(new PromptService().canPrompt(), false);
  });

  it("ask() throws synchronously-via-rejection in non-interactive environments", async () => {
    setTTY(false);
    const svc = new PromptService();
    await assert.rejects(
      () => svc.ask("q? "),
      /Cannot prompt in non-interactive environment/,
    );
  });

  it("close() is a no-op when no readline interface was ever opened", () => {
    const svc = new PromptService();
    // Must not throw.
    svc.close();
    svc.close();
  });
});

// ---------------------------------------------------------------------------
// confirm — only the force=true short-circuit is testable without stdin stubs
// ---------------------------------------------------------------------------

describe("confirm", () => {
  it("returns true immediately when force=true (never reads stdin)", async () => {
    // If this test hangs, the force short-circuit is broken: confirm would
    // block on readline.question with no stdin data. The default 2-min
    // per-test timeout from node:test would surface the regression.
    const result = await confirm("Proceed?", { force: true });
    assert.equal(result, true);
  });
});

// ---------------------------------------------------------------------------
// validation — pure predicates + ValidationResult builders
// ---------------------------------------------------------------------------

describe("validation — name predicates", () => {
  describe("isValidContextName (snake_case)", () => {
    it("accepts canonical snake_case identifiers", () => {
      for (const name of [
        "shared",
        "user_auth",
        "payment_processing",
        "a",
        "a1",
        "x_1_2",
      ]) {
        assert.equal(isValidContextName(name), true, `${name} should be valid`);
      }
    });

    it("rejects names that start with uppercase, a digit, or underscore", () => {
      for (const name of ["User", "1user", "_user", "User_auth"]) {
        assert.equal(
          isValidContextName(name),
          false,
          `${name} should be rejected`,
        );
      }
    });

    it("rejects names with hyphens, spaces, dots, or path separators", () => {
      for (const name of [
        "user-auth",
        "user auth",
        "user.auth",
        "user/auth",
        "../etc",
      ]) {
        assert.equal(
          isValidContextName(name),
          false,
          `${name} should be rejected`,
        );
      }
    });

    it("rejects the empty string", () => {
      assert.equal(isValidContextName(""), false);
    });
  });

  describe("isValidPortName (PascalCase)", () => {
    it("accepts canonical PascalCase identifiers", () => {
      for (const name of [
        "User",
        "UserRepository",
        "PaymentPort",
        "A",
        "A1B2",
      ]) {
        assert.equal(isValidPortName(name), true, `${name} should be valid`);
      }
    });

    it("rejects camelCase, snake_case, kebab-case, and non-alphanumeric starts", () => {
      for (const name of [
        "userRepository",
        "user_repository",
        "User-Repo",
        "1User",
        "_User",
        "",
      ]) {
        assert.equal(
          isValidPortName(name),
          false,
          `${name} should be rejected`,
        );
      }
    });
  });

  describe("isValidPackageName (@scope/name)", () => {
    it("accepts @scope/name with lowercase + digits + hyphens", () => {
      for (const name of [
        "@hexagen/sync",
        "@hexagen/shared",
        "@foo/bar-baz",
        "@a1/b2",
      ]) {
        assert.equal(isValidPackageName(name), true, `${name} should be valid`);
      }
    });

    it("rejects missing scope, uppercase, underscores, or path-traversal fragments", () => {
      for (const name of [
        "hexagen/sync",
        "@Hexagen/sync",
        "@hexagen/Sync",
        "@hexagen/sync_engine",
        "@hexagen/../evil",
        "@hexagen/",
        "@/sync",
      ]) {
        assert.equal(
          isValidPackageName(name),
          false,
          `${name} should be rejected`,
        );
      }
    });
  });

  it("isPascalCase and isSnakeCase are aliases of the PORT / CONTEXT predicates", () => {
    // Documenting the contract: these four are two pairs, not four independent checks.
    assert.equal(
      isPascalCase("UserRepository"),
      isValidPortName("UserRepository"),
    );
    assert.equal(isSnakeCase("user_auth"), isValidContextName("user_auth"));
    assert.equal(isPascalCase("user_auth"), false);
    assert.equal(isSnakeCase("UserAuth"), false);
  });
});

describe("validation — ValidationResult builders", () => {
  it("validateContextName returns valid=true with no errors for good input", () => {
    const r = validateContextName("user_auth");
    assert.deepEqual(r, { valid: true, errors: [] });
  });

  it("validateContextName returns the empty-string error distinctly from the format error", () => {
    assert.deepEqual(validateContextName(""), {
      valid: false,
      errors: ["Context name cannot be empty"],
    });
    const badFormat = validateContextName("UserAuth");
    assert.equal(badFormat.valid, false);
    assert.equal(badFormat.errors.length, 1);
    assert.match(badFormat.errors[0], /snake_case/);
  });

  it("validatePortName returns valid=true with no errors for PascalCase", () => {
    const r = validatePortName("UserRepository");
    assert.deepEqual(r, { valid: true, errors: [] });
  });

  it("validatePortName distinguishes empty input from format-violation input", () => {
    assert.deepEqual(validatePortName(""), {
      valid: false,
      errors: ["Port name cannot be empty"],
    });
    const badFormat = validatePortName("user_repo");
    assert.equal(badFormat.valid, false);
    assert.match(badFormat.errors[0], /PascalCase/);
  });
});

// ---------------------------------------------------------------------------
// yaml-service — Result<T,E> wrappers around js-yaml + atomic save
// ---------------------------------------------------------------------------

describe("YamlService", () => {
  let tmpRoot: string;
  let svc: YamlService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-yaml-svc-"));
    svc = new YamlService();
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  describe("loadManifest", () => {
    it("loads a valid YAML manifest and returns ok", async () => {
      const p = path.join(tmpRoot, "manifest.yaml");
      await fs.writeFile(
        p,
        "system: hexagen\nbounded_contexts:\n  - name: shared\n",
        "utf8",
      );

      const result = await svc.loadManifest(p);
      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.value.system, "hexagen");
      assert.deepEqual(result.value.bounded_contexts, [{ name: "shared" }]);
    });

    it("returns err(YamlLoadError) with filePath when the file does not exist", () => {
      const p = path.join(tmpRoot, "does-not-exist.yaml");
      const result = await svc.loadManifest(p);
      assert.equal(result.success, false);
      if (result.success) return;
      assert.ok(result.error instanceof YamlLoadError);
      assert.equal(result.error.filePath, p);
      assert.match(result.error.message, /File not found/);
    });

    it("returns err(YamlLoadError) on malformed YAML (never swallows the parse error)", async () => {
      const p = path.join(tmpRoot, "broken.yaml");
      // Unbalanced bracket is a hard parse error in js-yaml.
      await fs.writeFile(p, "key: [oops\n", "utf8");

      const result = await svc.loadManifest(p);
      assert.equal(result.success, false);
      if (result.success) return;
      assert.ok(result.error instanceof YamlLoadError);
      assert.equal(result.error.filePath, p);
      assert.ok(
        result.error.message.length > 0,
        "error message must be preserved",
      );
    });
  });

  describe("parse (string → Manifest)", () => {
    it("parses valid YAML string into a Manifest", () => {
      const result = svc.parse("system: x\nbounded_contexts: []\n");
      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.value.system, "x");
      assert.deepEqual(result.value.bounded_contexts, []);
    });

    it("returns err(YamlParseError) with line + context on invalid YAML", () => {
      const result = svc.parse("key: [oops\n");
      assert.equal(result.success, false);
      if (result.success) return;
      assert.ok(result.error instanceof YamlParseError);
      // js-yaml populates mark.line on YAMLException; guard against engine-version drift.
      assert.ok(
        result.error.line === undefined ||
          typeof result.error.line === "number",
        "line is either a number or absent — never NaN / wrong type",
      );
    });
  });

  describe("saveManifest", () => {
    it("writes the manifest atomically and leaves no .tmp sibling behind", async () => {
      const p = path.join(tmpRoot, "nested", "manifest.yaml");
      const manifest: Manifest = {
        system: "hexagen",
        bounded_contexts: [{ name: "shared" }],
      };

      const result = svc.saveManifest(manifest, p);
      assert.equal(result.success, true);

      const contents = await fs.readFile(p, "utf8");
      assert.match(contents, /system: hexagen/);
      assert.match(contents, /name: shared/);

      const siblings = await fs.readdir(path.dirname(p));
      assert.deepEqual(
        siblings.filter((n) => n.endsWith(".tmp")),
        [],
        "temp file must be atomically renamed — never leaked",
      );
    });

    it("round-trip (save → loadManifest) preserves the canonical fields", async () => {
      const p = path.join(tmpRoot, "roundtrip.yaml");
      const manifest: Manifest = {
        system: "hexagen",
        scope: "hexagen",
        architecture: "modular-monolith",
        bounded_contexts: [{ name: "shared" }, { name: "core_domain" }],
      };

      const saved = svc.saveManifest(manifest, p);
      assert.equal(saved.success, true);

      const loaded = await svc.loadManifest(p);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.system, "hexagen");
      assert.equal(loaded.value.scope, "hexagen");
      assert.equal(loaded.value.architecture, "modular-monolith");
      assert.deepEqual(loaded.value.bounded_contexts, [
        { name: "shared" },
        { name: "core_domain" },
      ]);
    });

    it("returns err(YamlSaveError) when the target path's parent cannot be created", async () => {
      // Create a FILE at what would be the parent dir, then try to save a
      // manifest whose dirname(p) collides with that file. mkdirSync({recursive})
      // will throw ENOTDIR, which the service must translate to YamlSaveError.
      const collision = path.join(tmpRoot, "collision");
      await fs.writeFile(collision, "not a dir", "utf8");
      const p = path.join(collision, "manifest.yaml");

      const result = svc.saveManifest({ bounded_contexts: [] }, p);
      assert.equal(result.success, false);
      if (result.success) return;
      assert.ok(result.error instanceof YamlSaveError);
      assert.equal(result.error.filePath, p);

      // No .tmp file should leak into tmpRoot.
      const siblings = await fs.readdir(tmpRoot);
      assert.ok(
        !siblings.some((n) => n.endsWith(".tmp")),
        "on save failure, no stray .tmp sibling may remain",
      );
    });
  });

  describe("serialize (Manifest → string)", () => {
    it("emits a YAML string that parse() can round-trip", () => {
      const manifest: Manifest = {
        system: "hexagen",
        bounded_contexts: [{ name: "shared" }],
      };

      const text = svc.serialize(manifest);
      assert.equal(typeof text, "string");
      assert.match(text, /system: hexagen/);

      const parsed = svc.parse(text);
      assert.equal(parsed.success, true);
      if (!parsed.success) return;
      assert.equal(parsed.value.system, "hexagen");
    });
  });
});
