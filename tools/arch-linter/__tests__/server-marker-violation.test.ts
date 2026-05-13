import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LinterConfig } from "../src/index.js";
import {
  hasServerOnlyMarker,
  checkUnexpectedMarker,
  checkMissingMarker,
  resolveServerBarrelPath,
} from "../src/server-marker-violation.js";

const CONFIG_WITH_MARKER: LinterConfig = {
  subpath_conventions: {
    server: {
      allowed_consumers: [
        "sync",
        "mcp-server",
        "tui",
        "api-gateway",
        "project-generation",
        "arch-linter",
      ],
      enforcement: "error",
      require_marker: true,
      marker_exclusions: [],
    },
    client: {
      allowed_consumers: [],
      enforcement: "warn",
    },
  },
};

const CONFIG_NO_MARKER_CHECK: LinterConfig = {
  subpath_conventions: {
    server: {
      allowed_consumers: [],
      enforcement: "error",
      require_marker: false,
    },
    client: {
      allowed_consumers: [],
      enforcement: "warn",
    },
  },
};

describe("hasServerOnlyMarker", () => {
  it("detects marker on first line", () => {
    const source = `// @hexagen-server-only\nexport { foo } from './foo.js';`;
    assert.ok(hasServerOnlyMarker(source));
  });

  it("detects marker in multi-line comment", () => {
    const source = `/**\n * @hexagen-server-only\n */\nexport { bar } from './bar.js';`;
    assert.ok(hasServerOnlyMarker(source));
  });

  it("ignores marker in code comments (after first code statement)", () => {
    const source = `export function foo() {\n  // @hexagen-server-only - not here\n}`;
    assert.ok(!hasServerOnlyMarker(source));
  });

  it("ignores marker after import statement (convention enforcement)", () => {
    const source = `import type { Foo } from './foo.js';\n// @hexagen-server-only\nexport { bar } from './bar.js';`;
    assert.ok(!hasServerOnlyMarker(source));
  });

  it("returns false for file with no marker", () => {
    const source = `export { foo } from './foo.js';`;
    assert.ok(!hasServerOnlyMarker(source));
  });

  it("returns false for empty file", () => {
    assert.ok(!hasServerOnlyMarker(""));
  });
});

describe("checkUnexpectedMarker", () => {
  it("detects marker in non-server file", () => {
    const violation = checkUnexpectedMarker(
      "packages/foo/src/index.ts",
      "// @hexagen-server-only\nexport { x } from './x.js';",
      CONFIG_WITH_MARKER,
    );
    assert.strictEqual(violation?.type, "unexpected-server-marker");
  });

  it("allows marker in server.ts", () => {
    const violation = checkUnexpectedMarker(
      "packages/foo/src/server.ts",
      "// @hexagen-server-only\nexport { x } from './x.js';",
      CONFIG_WITH_MARKER,
    );
    assert.strictEqual(violation, null);
  });

  it("skips check when require_marker is false", () => {
    const violation = checkUnexpectedMarker(
      "packages/foo/src/index.ts",
      "// @hexagen-server-only\nexport { x } from './x.js';",
      CONFIG_NO_MARKER_CHECK,
    );
    assert.strictEqual(violation, null);
  });

  it("returns null for file without marker", () => {
    const violation = checkUnexpectedMarker(
      "packages/foo/src/index.ts",
      "export { x } from './x.js';",
      CONFIG_WITH_MARKER,
    );
    assert.strictEqual(violation, null);
  });
});

describe("checkMissingMarker", () => {
  it("detects missing marker in server barrel", () => {
    const mockRead = () => "export { x } from './x.js';";
    const mockExists = () => true;
    const violation = checkMissingMarker(
      "/packages/foo",
      "foo",
      { "./server": "./dist/server.js" },
      CONFIG_WITH_MARKER,
      mockRead as (filePath: string) => string,
      mockExists as (filePath: string) => boolean,
    );
    assert.strictEqual(violation?.type, "missing-server-marker");
  });

  it("allows server barrel with marker", () => {
    const mockRead = () =>
      "// @hexagen-server-only\nexport { x } from './x.js';";
    const mockExists = () => true;
    const violation = checkMissingMarker(
      "/packages/foo",
      "foo",
      { "./server": "./dist/server.js" },
      CONFIG_WITH_MARKER,
      mockRead as (filePath: string) => string,
      mockExists as (filePath: string) => boolean,
    );
    assert.strictEqual(violation, null);
  });

  it("respects exclusion list", () => {
    const configWithExclusion: LinterConfig = {
      subpath_conventions: {
        server: {
          allowed_consumers: [],
          enforcement: "error",
          require_marker: true,
          marker_exclusions: [{ package: "local-llm", reason: "DEBT-001" }],
        },
      },
    };
    const mockRead = () => "export { x } from './x.js';";
    const mockExists = () => true;
    const violation = checkMissingMarker(
      "/packages/local-llm",
      "local-llm",
      { "./server": "./dist/server.js" },
      configWithExclusion,
      mockRead as (filePath: string) => string,
      mockExists as (filePath: string) => boolean,
    );
    assert.strictEqual(violation, null);
  });

  it("detects broken server export", () => {
    const mockRead = () => "";
    const mockExists = () => false;
    const violation = checkMissingMarker(
      "/packages/foo",
      "foo",
      { "./server": "./dist/server.js" },
      CONFIG_WITH_MARKER,
      mockRead as (filePath: string) => string,
      mockExists as (filePath: string) => boolean,
    );
    assert.strictEqual(violation?.type, "broken-server-export");
  });

  it("skips check when require_marker is false", () => {
    const mockRead = () => "export { x } from './x.js';";
    const mockExists = () => true;
    const violation = checkMissingMarker(
      "/packages/foo",
      "foo",
      { "./server": "./dist/server.js" },
      CONFIG_NO_MARKER_CHECK,
      mockRead as (filePath: string) => string,
      mockExists as (filePath: string) => boolean,
    );
    assert.strictEqual(violation, null);
  });

  it("returns null when package has no ./server export", () => {
    const mockRead = () => "";
    const mockExists = () => true;
    const violation = checkMissingMarker(
      "/packages/foo",
      "foo",
      { ".": "./dist/index.js" },
      CONFIG_WITH_MARKER,
      mockRead as (filePath: string) => string,
      mockExists as (filePath: string) => boolean,
    );
    assert.strictEqual(violation, null);
  });
});

describe("resolveServerBarrelPath", () => {
  it("resolves string export path", () => {
    const result = resolveServerBarrelPath(
      "/packages/foo",
      "./dist/server.js",
      () => true,
    );
    assert.ok(result?.endsWith("src/server.ts"));
  });

  it("resolves conditions export (types path)", () => {
    const result = resolveServerBarrelPath(
      "/packages/foo",
      { types: "./dist/server.d.ts", import: "./dist/server.js" },
      () => true,
    );
    assert.ok(result?.endsWith("src/server.ts"));
  });

  it("returns null if source file missing", () => {
    const result = resolveServerBarrelPath(
      "/packages/foo",
      "./dist/server.js",
      () => false,
    );
    assert.strictEqual(result, null);
  });
});
