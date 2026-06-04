import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import { createFileSystemTemplateFileLoader } from "../../src/infrastructure/file-system-template-file-loader.js";
import { InMemoryAddOnMaterializer } from "../../src/infrastructure/in-memory-add-on-materializer.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);
const materializer = new InMemoryAddOnMaterializer(
  new FileSystemTemplateRegistry(TEMPLATES_DIR),
  createFileSystemTemplateFileLoader(TEMPLATES_DIR),
);

const REGISTER = "src/infrastructure/mcp/transport/register-transports.ts";
const HTTP = "src/infrastructure/mcp/transport/http.ts";

describe("mcp-server-http template — emit shape", () => {
  it("co-emits the stdio base and re-emits register-transports with BOTH transports", async () => {
    const { files, errors } = await materializer.materialize(
      { "mcp-server-http": { auth: "bearer", http_port: "3333" } },
      { projectName: "acme" },
    );
    assert.deepEqual(errors, [], "valid selection materializes without errors");

    // requires: mcp-server (which requires env-setup) — base co-emitted
    assert.ok(
      files.has("src/infrastructure/mcp/server.ts"),
      "base server.ts co-emitted",
    );
    assert.ok(
      files.has("src/infrastructure/mcp/transport/stdio.ts"),
      "base stdio transport co-emitted",
    );

    // http addon files
    assert.ok(files.has(HTTP), "http transport emitted");
    assert.ok(files.has("src/infrastructure/mcp/guard.ts"), "guard emitted");
    assert.ok(files.has(".env.mcp-http.example"), "http env example emitted");

    // the seam: http's register-transports overwrote the base's stdio-only one,
    // registering BOTH (last-writer-wins; http is emitted after its dependency).
    const register = files.get(REGISTER) ?? "";
    assert.match(
      register,
      /registerTransport\("stdio"/,
      "stdio registration preserved in the re-emit",
    );
    assert.match(
      register,
      /registerTransport\("streamable-http"/,
      "streamable-http registration added by the addon",
    );
  });

  it("emits only the chosen auth implementation and resolves {auth} in http.ts (bearer)", async () => {
    const { files } = await materializer.materialize(
      { "mcp-server-http": { auth: "bearer" } },
      { projectName: "acme" },
    );
    assert.ok(
      files.has("src/infrastructure/mcp/auth/bearer.ts"),
      "bearer emitted",
    );
    assert.ok(
      !files.has("src/infrastructure/mcp/auth/oauth.ts"),
      "oauth NOT emitted when auth=bearer",
    );
    const http = files.get(HTTP) ?? "";
    assert.match(
      http,
      /from "\.\.\/auth\/bearer\.js"/,
      "http imports the bearer auth module",
    );
    assert.ok(
      !http.includes("{auth}"),
      "no unresolved {auth} placeholder leaks into http.ts",
    );
  });

  it("emits only the chosen auth implementation and resolves {auth} in http.ts (oauth)", async () => {
    const { files } = await materializer.materialize(
      { "mcp-server-http": { auth: "oauth" } },
      { projectName: "acme" },
    );
    assert.ok(
      files.has("src/infrastructure/mcp/auth/oauth.ts"),
      "oauth emitted",
    );
    assert.ok(
      !files.has("src/infrastructure/mcp/auth/bearer.ts"),
      "bearer NOT emitted when auth=oauth",
    );
    assert.match(
      files.get(HTTP) ?? "",
      /from "\.\.\/auth\/oauth\.js"/,
      "http imports the oauth auth module",
    );
  });

  it("gates test scaffolds behind --with-tests (and by the auth answer)", async () => {
    const base = await materializer.materialize(
      { "mcp-server-http": { auth: "bearer" } },
      { projectName: "acme" },
    );
    assert.ok(
      !base.files.has("src/infrastructure/mcp/guard.test.ts"),
      "guard.test gated off by default",
    );
    assert.ok(
      !base.files.has("src/infrastructure/mcp/auth/bearer.test.ts"),
      "bearer.test gated off by default",
    );

    const withTests = await materializer.materialize(
      { "mcp-server-http": { auth: "bearer" } },
      { projectName: "acme", withTests: true },
    );
    assert.ok(
      withTests.files.has("src/infrastructure/mcp/guard.test.ts"),
      "guard.test emitted under --with-tests",
    );
    assert.ok(
      withTests.files.has("src/infrastructure/mcp/auth/bearer.test.ts"),
      "bearer.test emitted under --with-tests",
    );
    assert.ok(
      !withTests.files.has("src/infrastructure/mcp/auth/oauth.test.ts"),
      "oauth.test still gated off by the auth=bearer answer",
    );
    assert.match(
      withTests.files.get("src/infrastructure/mcp/guard.test.ts") ?? "",
      /from "node:test"/,
      "test scaffolds target the generated core's runner (node:test)",
    );
  });
});
