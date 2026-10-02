import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STEP_COMMANDS } from "../steps";

/**
 * Pins every shown command against the real commander definitions, read as
 * source (importing @hexagen/sync into the web bundle is not cheap). A flag or
 * subcommand that is renamed there fails here.
 */
const SYNC = path.resolve(
  __dirname,
  "../../../../../packages/sync/src/commands",
);
const src = (rel: string) => readFileSync(path.join(SYNC, rel), "utf8");

interface Pin {
  readonly id: keyof typeof STEP_COMMANDS;
  /** Index of the command in the step's list. */
  readonly at: number;
  readonly file: string;
  /** The `.command("...")` text, or null for a top-level commander. */
  readonly sub: string | null;
  readonly top: string;
  /** The CLI group when it is not the step id. */
  readonly group?: string;
  readonly required: readonly string[];
}

const PINS: readonly Pin[] = [
  {
    id: "observe",
    at: 0,
    file: "observe/index.ts",
    sub: null,
    top: 'new Command("observe")',
    required: [],
  },
  {
    id: "slice",
    at: 0,
    file: "slice/index.ts",
    sub: "init",
    top: "hexagen slice",
    required: ["--path"],
  },
  {
    id: "contract",
    at: 0,
    file: "contract/index.ts",
    sub: "add-rule",
    top: "hexagen contract",
    required: ["--kind", "--from", "--to"],
  },
  {
    id: "contract",
    at: 1,
    file: "contract/index.ts",
    sub: "check",
    top: "hexagen contract",
    required: [],
  },
  {
    id: "grant",
    at: 0,
    file: "grant/issue.ts",
    sub: "issue",
    top: "hexagen grant",
    required: ["--principal", "--agent", "--tools", "--expires-in"],
  },
  {
    id: "evidence",
    at: 0,
    file: "evidence/index.ts",
    sub: "pack <trace>",
    top: "hexagen evidence",
    required: ["--grant", "--out"],
  },
  {
    id: "evidence",
    at: 1,
    file: "workbook/index.ts",
    sub: "export",
    top: "hexagen workbook",
    group: "workbook",
    required: [],
  },
];

const flagsOf = (cmd: string) =>
  [...cmd.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]);

describe("step commands match the real CLI", () => {
  for (const pin of PINS) {
    const cmd = STEP_COMMANDS[pin.id].commands[pin.at] as string;
    const source = src(pin.file);

    it(`${cmd}`, () => {
      expect(cmd.startsWith(`hexagen ${pin.group ?? pin.id}`)).toBe(true);
      if (pin.sub !== null) {
        expect(source).toContain(`.command("${pin.sub}")`);
        expect(cmd).toMatch(new RegExp(` ${pin.sub.split(" ")[0]}( |$)`));
      }
      for (const flag of flagsOf(cmd)) {
        expect(source, flag).toMatch(
          new RegExp(`\\("${flag}[ "]|\\(\\s*"${flag}[ "]`),
        );
      }
      for (const flag of pin.required) {
        expect(cmd, `required ${flag}`).toContain(flag);
        expect(source).toMatch(new RegExp(`requiredOption\\(\\s*"${flag}[ "]`));
      }
    });
  }

  it("coverage floor: every hexagen command is matched by exactly one pin", () => {
    let seen = 0;
    for (const [id, step] of Object.entries(STEP_COMMANDS)) {
      step.commands.forEach((cmd, at) => {
        if (!cmd.startsWith("hexagen ")) return;
        seen++;
        const hits = PINS.filter((p) => p.id === id && p.at === at);
        expect(hits, cmd).toHaveLength(1);
      });
    }
    expect(seen).toBe(PINS.length);
  });

  it("contract add-rule defines --yes, so the shown command may carry it", () => {
    const source = src("contract/index.ts");
    const from = source.indexOf('.command("add-rule")');
    const to = source.indexOf(".command(", from + 1);
    expect(from).toBeGreaterThan(-1);
    expect(source.slice(from, to)).toContain('"--yes"');
  });

  it("the workbook export writes outside evidence/ and needs no --yes", () => {
    expect(STEP_COMMANDS.evidence.commands[1]).toBe(
      "hexagen workbook export --out .hexagen/workbook.zip",
    );
  });

  it("every command that writes carries --yes, as its source requires", () => {
    for (const [id, file] of [
      ["observe", "observe/index.ts"],
      ["slice", "slice/index.ts"],
      ["grant", "grant/issue.ts"],
    ] as const) {
      expect(src(file)).toContain('"--yes"');
      expect(STEP_COMMANDS[id].commands[0]).toContain("--yes");
    }
    expect(STEP_COMMANDS.contract.commands[0]).toContain("--yes");
  });

  it("the grant is minted in propose mode into a new file under .hexagen/", () => {
    const grant = STEP_COMMANDS.grant.commands[0] as string;
    expect(grant).toContain("--mode propose");
    expect(grant).toContain("--out .hexagen/grants/<id>.json");
  });

  it("the pack command uses the real default trace path", () => {
    expect(src("evidence/pack.ts")).toContain(
      '[".hexagen", "evidence", "trace.jsonl"]',
    );
    expect(STEP_COMMANDS.evidence.commands[0]).toContain(
      "pack .hexagen/evidence/trace.jsonl ",
    );
  });
});
