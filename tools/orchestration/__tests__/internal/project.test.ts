import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFor } from "../../src/internal/project.js";

/**
 * `loadConfigFor` — the project-facing loader the bins call.
 *
 * `gh` is injected: what is under test is what the loader does with `gh`'s
 * ANSWER, and a real `gh` would make the answer depend on the machine.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function project(config: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), "orchestration-project-"));
  dirs.push(root);
  if (config !== undefined) {
    mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
    writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
  }
  return root;
}

describe("F5: a repo from gh is validated, and its problem is kept", () => {
  const gh = (answer: string | undefined) => ({
    readRepository: () => answer,
  });

  test("gh answering not-a-repo is a problem naming repo when the file is absent", async () => {
    const loaded = await loadConfigFor(project(undefined), gh("not-a-repo"));
    expect(loaded.problems.map((p) => p.at)).toEqual(["repo"]);
    expect(loaded.config.repo).toBeUndefined();
  });

  test("gh answering not-a-repo is a problem naming repo when the file is present", async () => {
    const loaded = await loadConfigFor(
      project("planDir: docs/planning\n"),
      gh("not-a-repo"),
    );
    expect(loaded.problems.map((p) => p.at)).toEqual(["repo"]);
    expect(loaded.config.repo).toBeUndefined();
  });

  test("a valid gh answer is used, with no problem", async () => {
    for (const config of [undefined, "planDir: docs/planning\n"]) {
      const loaded = await loadConfigFor(project(config), gh("acme/demo"));
      expect(loaded.problems).toEqual([]);
      expect(loaded.config.repo).toBe("acme/demo");
    }
  });

  test("the file's own repo wins, and gh is not consulted", async () => {
    let asked = false;
    const loaded = await loadConfigFor(project("repo: acme/own\n"), {
      readRepository: () => {
        asked = true;
        return "acme/other";
      },
    });
    expect(loaded.config.repo).toBe("acme/own");
    expect(asked).toBe(false);
  });
});
