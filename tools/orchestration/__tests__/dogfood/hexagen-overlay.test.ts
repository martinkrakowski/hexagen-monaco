import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { describe, expect, test } from "vitest";
import {
  CONFIG_RELATIVE_PATH,
  parseConfig,
} from "../../src/internal/config.js";
import { waveLogRoot } from "../../src/internal/logdir.js";

/**
 * hexagen-monaco dogfoods its own template (OW6). The repo-root overlay is read through the real
 * loader, so a value the loader would refuse or deprecate fails here before doctor ever runs.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const OVERLAY = path.join(REPO_ROOT, ".agents", "orchestration");

/**
 * The five `#`/`##` headings of the seat record this overlay's cast.md was relocated from
 * (F-10: relocated, never deleted). Embedded, because the source file lived in the owner's
 * untracked `.claude/` and is not in the repository.
 */
const OLD_CAST_HEADINGS = [
  "# The cast — verified invocations, model ids, and track record",
  "## Seats — the order the owner set on 2026-09-08 (implementers reordered the same day)",
  "## Spending rules (2026-09-08, after a gemini weekly quota went from ~97 % to 76 % in four runs)",
  "## Traps that have each cost a cycle",
  "## Track record, from waves run in this repo",
];

const parsed = parseConfig(
  fs.readFileSync(path.join(REPO_ROOT, CONFIG_RELATIVE_PATH), "utf8"),
);
const config = parsed.config!;

describe("hexagen-monaco's own orchestration overlay", () => {
  test("loads with no problems and no deprecations", () => {
    expect(parsed.problems).toEqual([]);
    expect(parsed.deprecations).toEqual([]);
    expect(config).toBeDefined();
  });

  test("with WAVE_LOG_ROOT unset, the log root is $HOME/.waves-hexagen", () => {
    expect(waveLogRoot({ HOME: "/home/x" }, config)).toBe(
      "/home/x/.waves-hexagen",
    );
    expect(config.waveLogDir).toBe("$HOME/.waves-hexagen");
  });

  test("gates on hexagen's sync-integrity job, and the workflow it names exists", () => {
    expect(config.requiredCheck).toBe("^Verify Sync Engine");
    expect(config.ciWorkflow).toBe(".github/workflows/sync-integrity.yml");
    expect(fs.existsSync(path.join(REPO_ROOT, config.ciWorkflow))).toBe(true);
  });

  test("requiredCheck matches at least one job name in the ciWorkflow", () => {
    const workflow = parseYaml(
      fs.readFileSync(path.join(REPO_ROOT, config.ciWorkflow), "utf8"),
    ) as { jobs?: Record<string, { name?: unknown } | null> };
    // A job's check name is `jobs.<id>.name`, or the id when it has none. Step names are not checks.
    const jobNames = Object.entries(workflow.jobs ?? {}).map(([id, job]) =>
      typeof job?.name === "string" ? job.name : id,
    );
    const pattern = new RegExp(config.requiredCheck);
    expect(jobNames.some((n) => pattern.test(n))).toBe(true);
  });

  test("the gate runs CI's steps in order, including the test-source typecheck", () => {
    expect(config.gateSteps.map((s) => [s.name, s.command])).toEqual([
      ["build", "yarn build"],
      ["typecheck", "yarn typecheck"],
      ["typecheck:test", "yarn typecheck:test"],
      ["lint", "yarn lint"],
      ["test", "yarn test"],
    ]);
  });

  test("refuses campaign-foundry's ports and binds 4318", () => {
    expect(config.forbiddenPorts).toEqual([3000, 3001, 4317]);
    expect(config.waveStatusPort).toBe(4318);
  });

  test("the midnight host is remote and targeted-only", () => {
    expect(config.laneHosts.map((h) => h.name)).toEqual(["midnight"]);
    const midnight = config.laneHosts[0]!;
    expect(midnight.gate).toBe("targeted-only");
    expect(midnight.dispatch).toEqual(["ocm-run"]);
    expect(midnight.check).toEqual(["ocm-run", "--check"]);
    // Remote is defined by carrying ssh, clone or worktrees; it carries all three.
    expect(midnight.ssh).toBe("m");
    expect(midnight.clone).toBe(
      "/mnt/pool/cloud-services/projects/hexagen-monaco",
    );
    expect(midnight.worktrees).toBe(
      "/mnt/pool/cloud-services/projects/.worktrees",
    );
  });

  test("both seats resolve to the midnight host", () => {
    expect(config.seats.map((s) => [s.id, s.agent, s.host])).toEqual([
      ["space-bunny", "lane", "midnight"],
      ["glm-flash", "lane-glm", "midnight"],
    ]);
    const hostNames = new Set(config.laneHosts.map((h) => h.name));
    for (const seat of config.seats)
      expect(hostNames.has(seat.host)).toBe(true);
  });
});

describe("hexagen-monaco's house-rules.md", () => {
  test("names waveLogDir as the source of the log directory", () => {
    const rules = fs.readFileSync(path.join(OVERLAY, "house-rules.md"), "utf8");
    // The rule cites the setting and states the value the overlay really carries, so the prose
    // cannot drift from config.waveLogDir.
    expect(rules).toContain("`waveLogDir` in `config.yaml`");
    expect(rules).toContain(`\`${config.waveLogDir}\``);
    expect(rules).not.toContain(".waves-hexagen-monaco");
  });
});

describe("hexagen-monaco's cast.md", () => {
  const cast = fs.readFileSync(path.join(OVERLAY, "cast.md"), "utf8");

  test.each(OLD_CAST_HEADINGS)("keeps the heading %s", (heading) => {
    expect(cast.split("\n")).toContain(heading);
  });

  test("refers to the opencode seats by id and never restates their model", () => {
    expect(cast).toContain("space-bunny");
    expect(cast).toContain("glm-flash");
    // The forbidden strings come from the seats themselves, so a model rotation in config.yaml
    // cannot leave a stale literal here: the full model and its last path segment.
    for (const seat of config.seats) {
      expect(cast).not.toContain(seat.model);
      expect(cast).not.toContain(seat.model.split("/").at(-1)!);
    }
  });

  test("carries no credential-file path", () => {
    expect(cast).not.toContain("auth.json");
  });

  test("points at laneHosts in config.yaml", () => {
    expect(cast).toContain("laneHosts");
  });

  test("refers to the configured gateSteps instead of hand-keeping the local checks", () => {
    expect(cast).toContain("`gateSteps`");
    expect(cast).not.toContain("yarn build && yarn typecheck");
  });
});
