import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATE_QUESTIONS } from "./template-questions.generated";
import type { TemplateQuestion } from "./types";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..", "..", "..", "..");
const TEMPLATES_DIR = path.join(
  REPO_ROOT,
  "packages",
  "template-engine",
  "templates",
);

describe("template-questions.generated — parity with manifests", () => {
  it("contains an entry for every template directory with a valid manifest", async () => {
    const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
    const expected = new Set<string>();
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith("__")) continue;
      try {
        const raw = await fs.readFile(
          path.join(TEMPLATES_DIR, e.name, "manifest.json"),
          "utf-8",
        );
        const parsed = JSON.parse(raw) as { id: string };
        expected.add(parsed.id);
      } catch {
        // not a template
      }
    }
    const actual = new Set(Object.keys(TEMPLATE_QUESTIONS));
    for (const id of expected) {
      assert.ok(
        actual.has(id),
        `TEMPLATE_QUESTIONS is missing ${id} — regenerate via \`yarn workspace web gen:template-questions\``,
      );
    }
  });

  it("includes shared-types' session_cookie_name as a text question", () => {
    const sharedTypes = TEMPLATE_QUESTIONS["shared-types"];
    assert.ok(sharedTypes, "shared-types template must be present");
    const cookieQ = sharedTypes.find((q) => q.id === "session_cookie_name");
    assert.ok(cookieQ, "session_cookie_name question must be present");
    assert.equal(cookieQ.type, "text");
  });

  it("includes auth-mock's session_cookie_name as an auto question derived from shared-types", () => {
    const authMock = TEMPLATE_QUESTIONS["auth-mock"];
    assert.ok(authMock, "auth-mock template must be present");
    const cookieQ = authMock.find((q) => q.id === "session_cookie_name");
    assert.ok(cookieQ, "session_cookie_name question must be present");
    assert.equal(cookieQ.type, "auto");
    if (cookieQ.type === "auto") {
      assert.equal(cookieQ.derivedFrom, "shared-types.session_cookie_name");
    }
  });
});

describe("template-questions step — interactive filtering", () => {
  // Replicates the filter the step uses to decide which sections to render.
  function interactiveOf(id: string): ReadonlyArray<TemplateQuestion> {
    const all = TEMPLATE_QUESTIONS[id] ?? [];
    return all.filter((q) => q.type !== "auto");
  }

  it("filters out auto-typed questions from auth-mock (leaving zero interactive)", () => {
    const interactive = interactiveOf("auth-mock");
    assert.equal(interactive.length, 0);
  });

  it("keeps text/select/boolean/multiselect questions on supabase", () => {
    const interactive = interactiveOf("supabase");
    assert.ok(interactive.length > 0);
    for (const q of interactive) {
      assert.notEqual(q.type, "auto");
    }
  });
});
