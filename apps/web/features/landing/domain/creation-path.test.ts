import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  CREATION_PATH_OPTIONS,
  CREATION_STEPS,
  type CreationPathId,
  IMPORT_SUB_OPTIONS,
  type ImportSubOptionId,
  detectInputMode,
} from "./creation-path.js";

describe("creation-path domain", () => {
  describe("CREATION_PATH_OPTIONS", () => {
    it("has exactly 3 options", () => {
      assert.strictEqual(CREATION_PATH_OPTIONS.length, 3);
    });

    it("has unique ids", () => {
      const ids = CREATION_PATH_OPTIONS.map((o) => o.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it("covers all CreationPathId values", () => {
      const expected: CreationPathId[] = ["blank", "import", "ai"];
      const actual = CREATION_PATH_OPTIONS.map((o) => o.id);
      assert.deepStrictEqual(actual.sort(), expected.sort());
    });

    it("has exactly one recommended option", () => {
      const recommended = CREATION_PATH_OPTIONS.filter((o) => o.isRecommended);
      assert.strictEqual(recommended.length, 1);
      assert.strictEqual(recommended[0].id, "ai");
    });

    it("each option has a non-empty label and description", () => {
      for (const option of CREATION_PATH_OPTIONS) {
        assert.ok(option.label.length > 0, `Empty label for ${option.id}`);
        assert.ok(
          option.description.length > 0,
          `Empty description for ${option.id}`,
        );
      }
    });

    it("each option has a valid colorTheme", () => {
      const validThemes = ["success", "info", "primary"];
      for (const option of CREATION_PATH_OPTIONS) {
        assert.ok(
          validThemes.includes(option.colorTheme),
          `Invalid colorTheme for ${option.id}: ${option.colorTheme}`,
        );
      }
    });
  });

  describe("IMPORT_SUB_OPTIONS", () => {
    it("has exactly 4 sub-options", () => {
      assert.strictEqual(IMPORT_SUB_OPTIONS.length, 4);
    });

    it("has unique ids", () => {
      const ids = IMPORT_SUB_OPTIONS.map((o) => o.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it("covers all ImportSubOptionId values", () => {
      const expected: ImportSubOptionId[] = [
        "spec",
        "scan",
        "artifacts",
        "github",
      ];
      const actual = IMPORT_SUB_OPTIONS.map((o) => o.id);
      assert.deepStrictEqual(actual.sort(), expected.sort());
    });

    it("each sub-option has a non-empty label and description", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        assert.ok(option.label.length > 0, `Empty label for ${option.id}`);
        assert.ok(
          option.description.length > 0,
          `Empty description for ${option.id}`,
        );
      }
    });

    it("each sub-option has a non-empty href", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        assert.ok(option.href.length > 0, `Empty href for ${option.id}`);
      }
    });

    it("artifacts sub-option is available and routes through the name step", () => {
      // Flipped by BF-3.3, which mounted /projects/new/import/artifacts. The
      // href still points at the shared name step: that step forwards the
      // entered name to the Tier-A screen via `?name=`, and the screen redirects
      // back to it when the name is missing, so the two legs are a loop rather
      // than two destinations.
      const artifacts = IMPORT_SUB_OPTIONS.find((o) => o.id === "artifacts");
      assert.ok(artifacts);
      assert.strictEqual(artifacts.status, "available");
      assert.strictEqual(artifacts.href, "/projects/new/name?path=artifacts");
    });

    it("github sub-option is available and links straight to the Tier-B screen", () => {
      // Flipped by BF-5.3, which mounted /projects/new/import/github (repo
      // entry + streaming scan). Unlike `scan` and `artifacts` this href does
      // NOT route through the shared name step, and that is deliberate rather
      // than an oversight: the Tier-B screen carries its own project-name
      // field, so the name step would be a screen the user did not ask for in
      // front of a screen that does not need it. It still HONOURS `?name=` when
      // something upstream supplies one.
      const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
      assert.ok(github);
      assert.strictEqual(github.status, "available");
      assert.strictEqual(github.href, "/projects/new/import/github");
    });

    it("github sub-option no longer advertises an OAuth connection", () => {
      // The pre-BF-5.3 copy promised "OAuth connection and repository
      // analysis". What shipped is an anonymous shallow clone of a PUBLIC
      // repository. Nothing structural stops that copy drifting back, and a
      // privacy claim that overstates what the product does is the one kind of
      // stale string this flow cannot carry — so it is pinned.
      const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
      assert.ok(github);
      const copy = `${github.label} ${github.description} ${github.detail}`;
      assert.ok(
        !/oauth/i.test(copy),
        "the GitHub sub-option must not claim an OAuth connection",
      );
      assert.ok(
        /public/i.test(copy),
        "the GitHub sub-option must say the repository has to be public",
      );
    });

    it("scan sub-option is available and routes through the name step", () => {
      const scan = IMPORT_SUB_OPTIONS.find((o) => o.id === "scan");
      assert.ok(scan);
      assert.strictEqual(scan.status, "available");
      assert.strictEqual(scan.href, "/projects/new/name?path=scan");
    });

    // `artifacts` LEFT this set in BF-3.3 and `github` in BF-5.3, each in the
    // packet that mounted its real screen — so the set is EMPTY today. The two
    // tests below are the ratchet: one fails if a routed option is left
    // "coming-soon", the other fails if an unrouted one is flipped to
    // "available", so neither half of the pair can move on its own.
    //
    // An empty set does not retire the ratchet; the next sub-option that is
    // designed before it is built goes in here, and both halves start biting
    // again. What an empty set DOES do is make the second test's loop vacuous,
    // so that test asserts the complement while the set is empty (see there) —
    // a silently no-op test that reads as a passing one is precisely the shape
    // this pair exists to prevent.
    const NOT_YET_ROUTED = new Set<ImportSubOptionId>([]);

    // Both tests above compare two IN-REPO CONSTANTS -- the option's `status`
    // and the NOT_YET_ROUTED literal -- and neither observes the filesystem.
    // So deleting or renaming the route file leaves them green while the
    // option keeps advertising a screen that no longer exists. The pair is a
    // consistency check between two declarations, not proof that a route is
    // mounted; this test supplies the missing half.
    it("every option claimed available has a page file actually mounted", () => {
      const appDir = path.resolve(__dirname, "..", "..", "..", "app");
      const ROUTE_FOR: Record<string, string> = {
        spec: "projects/new/import/spec/page.tsx",
        scan: "projects/new/import/scan/page.tsx",
        artifacts: "projects/new/import/artifacts/page.tsx",
        github: "projects/new/import/github/page.tsx",
      };
      for (const option of IMPORT_SUB_OPTIONS) {
        if (option.status !== "available") continue;
        const rel = ROUTE_FOR[option.id];
        assert.ok(rel, `no route mapping recorded for ${option.id}`);
        assert.ok(
          existsSync(path.join(appDir, rel)),
          `${option.id} is marked available but ${rel} does not exist`,
        );
      }
    });

    it("every sub-option with a mounted route is available", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        if (NOT_YET_ROUTED.has(option.id)) continue;
        assert.strictEqual(
          option.status,
          "available",
          `${option.id} should be available`,
        );
      }
    });

    it("sub-options without a mounted route are marked coming-soon", () => {
      // Guards the other direction: if a route lands and the status is not
      // flipped, or a status is flipped before its route exists, one of these
      // two tests fails rather than both silently agreeing.
      if (NOT_YET_ROUTED.size === 0) {
        // Nothing is unrouted today, so the loop below would assert nothing at
        // all. Assert the complement instead — every option available — which
        // is the exact condition that emptied the set. This branch disappears
        // on its own the moment a future unrouted option is added.
        assert.deepStrictEqual(
          IMPORT_SUB_OPTIONS.filter((o) => o.status !== "available").map(
            (o) => o.id,
          ),
          [],
          "NOT_YET_ROUTED is empty, so no sub-option may be coming-soon",
        );
      }
      for (const id of NOT_YET_ROUTED) {
        const option = IMPORT_SUB_OPTIONS.find((o) => o.id === id);
        assert.ok(option, `${id} should exist in IMPORT_SUB_OPTIONS`);
        assert.strictEqual(
          option.status,
          "coming-soon",
          `${id} has no mounted route yet, so it must be coming-soon`,
        );
      }
    });
  });

  describe("detectInputMode", () => {
    it("detects manifest from .yaml extension", () => {
      assert.strictEqual(
        detectInputMode("workspace:\n  name: foo", "manifest.yaml"),
        "manifest",
      );
    });

    it("detects manifest from .yml extension", () => {
      assert.strictEqual(
        detectInputMode("workspace:\n  name: foo", "manifest.yml"),
        "manifest",
      );
    });

    it("detects structured-config from .json extension", () => {
      assert.strictEqual(
        detectInputMode('{"workspace": {}}', "config.json"),
        "structured-config",
      );
    });

    it("detects structured-config from YAML file starting with JSON object", () => {
      assert.strictEqual(
        detectInputMode('{"contexts": []}', "config.yaml"),
        "structured-config",
      );
    });

    it("returns unknown for malformed JSON in .yaml file", () => {
      assert.strictEqual(
        detectInputMode("{invalid json}", "config.yaml"),
        "unknown",
      );
    });

    it("detects structured-config from content starting with { without extension", () => {
      assert.strictEqual(
        detectInputMode('{"contexts": []}'),
        "structured-config",
      );
    });

    it("detects structured-config from content starting with [ without extension", () => {
      assert.strictEqual(detectInputMode("[]"), "structured-config");
    });

    it("detects manifest from content with YAML key-value pattern", () => {
      assert.strictEqual(
        detectInputMode("workspace:\n  name: foo"),
        "manifest",
      );
    });

    it("returns unknown for ambiguous content", () => {
      assert.strictEqual(detectInputMode("just some text"), "unknown");
    });

    it("returns unknown for invalid JSON starting with {", () => {
      assert.strictEqual(detectInputMode("{invalid json}"), "unknown");
    });

    it("detects structured-config from content starting with [ with valid JSON", () => {
      assert.strictEqual(
        detectInputMode('[{"name": "ctx"}]'),
        "structured-config",
      );
    });
  });

  describe("CREATION_STEPS", () => {
    it("has exactly 3 steps", () => {
      assert.strictEqual(CREATION_STEPS.length, 3);
    });

    it("steps are numbered 1 through 3", () => {
      const steps = CREATION_STEPS.map((s) => s.step);
      assert.deepStrictEqual(steps, [1, 2, 3]);
    });

    it("each step has a non-empty label", () => {
      for (const step of CREATION_STEPS) {
        assert.ok(step.label.length > 0, `Empty label for step ${step.step}`);
      }
    });
  });
});
