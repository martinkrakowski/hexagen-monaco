import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The forbidden-string sweep over EVERYTHING this lane owns, tests included.
 *
 * The lists below are facts about one project that must never travel with a
 * packaged tool: its repository, its ports, its log root, its worktree prefix,
 * its application directories, its shell aliases, and the shell it was written
 * in. A tool that carried any of them would work on that one project and
 * nowhere else — and, because this repository is published, would publish them
 * besides.
 *
 * This file is the ONE thing excluded from its own scan, because it has to
 * spell the strings it is looking for. Everything else in the lane's ownership
 * is swept: the sources, the page, and every test and fixture beside them.
 */
const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const THIS_FILE = "forbidden-strings.test.ts";

/** Every directory and file this lane owns, relative to the package root. */
const OWNED: readonly string[] = [
  "src/wave-status",
  "src/bins/wave-status.ts",
  "public/wave-status",
  "__tests__/wave-status",
];

function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => filesUnder(join(path, name)));
}

/** Every file in the lane's ownership, tests and fixtures included. */
function ownedFiles(): string[] {
  return OWNED.flatMap((entry) => filesUnder(resolve(PACKAGE_ROOT, entry)))
    .filter((file) => /\.(ts|html|json|md)$/.test(file))
    .map((file) => relative(PACKAGE_ROOT, file))
    .filter((name) => name !== join("__tests__", "wave-status", THIS_FILE))
    .sort();
}

interface Forbidden {
  readonly label: string;
  readonly pattern: RegExp;
}

const FORBIDDEN: readonly Forbidden[] = [
  // A hardcoded repository, or the operator who owns it.
  {
    label: "a hardcoded repository or its owner",
    pattern: /martinkrakowski|campaign-?foundry|@campaignfoundry/gi,
  },
  // The source's own default port, and the pair it reserved by name.
  { label: "a literal port", pattern: /\b4317\b/g },
  // A shared home-directory wave log root, in either spelling.
  {
    label: "the shared wave log root",
    pattern: /~[/\\]\.waves|\$HOME[/\\]\.waves/g,
  },
  // The source project's seats: the vendors, models and runners its wave logs
  // named. A seat string in a fixture is a record of what one operator ran.
  {
    label: "a vendor, model or runner name from the source's seats",
    pattern: /\bagy\b|gemini|opencode|big[-_ ]?pickle|glm-\d/gi,
  },
  // The source project's own wave. Assembled from its two words rather than
  // spelled out, so this list does not itself put the name into the package;
  // the boundary is a hyphen or any non-word character between them.
  {
    label: "the source project's wave id",
    pattern: new RegExp(`${"creative"}[-_ ]${"templates"}`, "gi"),
  },
  // The source's other two wave families. Each is assembled from two literal
  // halves, never spelled whole, for the same reason as the one above; the
  // second half of each carries the wave's ordinal shape.
  {
    label: "the source project's status wave family",
    pattern: new RegExp(`${"wave"}[-_ ]${"status"}[-_ ]w\\d`, "gi"),
  },
  {
    label: "the source project's short wave family",
    pattern: new RegExp(`${"wave"}[-_ ]${"ct"}[-_ ]\\d`, "gi"),
  },
  // The worktree naming convention of one project.
  { label: "a hardcoded worktree prefix", pattern: /\bcf-/g },
  // Another application's directories, and this repository's shell aliases.
  {
    label: "another application, or a shell alias for this repository's bins",
    pattern:
      /\bapps\/(web|api)\b|\bnitro\b|yarn\s+(plan:review|sweep|mutate|gate|wave:status)\b/g,
  },
  // A language this package dropped as a capability.
  { label: "python", pattern: /\bpython3?\b/g },
];

/**
 * The two `PORT` cases, named by the file that holds them. Each is a test that
 * proves a refusal — or the absence of one — for that very number, so the
 * number has to be there to be the subject. The sweep below allows a hit only
 * in one of these, on a line that is naming the port, and the last test asserts
 * that each allowance is still the case it claims to be.
 */
/**
 * The two `PORT` cases, named by FILE and by the TEST they live in. Each exists
 * to prove a refusal — or the absence of one — for that very number, so the
 * number has to be there to be the subject. The sweep allows a hit anywhere
 * inside one of these cases and nowhere else, and the last test asserts that
 * each allowance is still the case it claims to be, so a pattern that stopped
 * matching could not silently widen the exception.
 */
const PORT_EXCEPTIONS: readonly {
  readonly file: string;
  readonly test: string;
}[] = [
  {
    file: "__tests__/wave-status/server.test.ts",
    test: "PORT=3000 is ALLOWED when the file forbids no ports — RED PROOF",
  },
  {
    file: "__tests__/wave-status/server.test.ts",
    test: "PORT=3000 is refused when the file lists it, naming the port and forbiddenPorts",
  },
  {
    file: "__tests__/wave-status/bin.test.ts",
    test: "PORT=3000 with an empty forbiddenPorts is ALLOWED — RED PROOF",
  },
  {
    file: "__tests__/wave-status/bin.test.ts",
    test: "--print with PORT=3000 and forbiddenPorts: [3000] still prints",
  },
  {
    file: "__tests__/wave-status/bin.test.ts",
    test: "PORT=3000 IS refused when the file lists it, naming the port and forbiddenPorts",
  },
];

const PORT_PATTERN = /3000|3001/g;

/**
 * The 4-5 digit literals that are legitimately in the server, each with its
 * reason. Anything else that looks like a port is a hardcoded one.
 */
const ALLOWED_NUMBER_LITERALS: Readonly<Record<string, string>> = {
  "65535": "the highest valid TCP port, the bound resolvePort checks against",
  "1024": "bytes per KB, converting the ?tail= parameter",
};

/**
 * Every 4-5 digit literal in `text` that could be a port: not part of a hex
 * colour or hex number, a dotted address or version, an underscore-separated
 * number, or an identifier; and not one of the allow-listed constants.
 */
function portLiterals(text: string): string[] {
  return [...text.matchAll(/(?<![\w#]|\d\.)(\d{4,5})(?!\w|\.\d)/g)]
    .map((match) => match[1])
    .filter((literal) => !(literal in ALLOWED_NUMBER_LITERALS));
}

/** The whole line a match at `index` sits on. */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

interface Hit {
  readonly file: string;
  readonly label: string;
  readonly line: number;
  readonly text: string;
}

/** The lines a test case occupies, from its `test("…"` line to its closing brace. */
function spanOf(text: string, testName: string): readonly [number, number] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(`test("${testName}"`));
  if (start === -1) return [Number.MAX_SAFE_INTEGER, -1];
  for (let i = start + 1; i < lines.length; i++) {
    // A case ends at the first line that closes it at the describe's own indent.
    if (lines[i] === "  });" || lines[i] === "  }, 60_000);") return [start, i];
  }
  return [start, lines.length - 1];
}

function sweep(
  files: readonly string[],
  patterns: readonly { readonly pattern: RegExp; readonly label: string }[],
): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const text = readFileSync(resolve(PACKAGE_ROOT, file), "utf8");
    for (const { pattern, label } of patterns) {
      for (const match of text.matchAll(pattern)) {
        hits.push({
          file,
          label,
          line: text.slice(0, match.index ?? 0).split("\n").length,
          text: lineAt(text, match.index ?? 0).trim(),
        });
      }
    }
  }
  return hits;
}

describe("nothing this lane owns carries another project's facts", () => {
  const files = ownedFiles();

  test("the sweep sees the whole ownership, tests and fixtures included", () => {
    // A sweep that quietly scanned nothing would pass everything below.
    expect(files.length).toBeGreaterThan(10);
    for (const expected of [
      join("src", "wave-status", "server.ts"),
      join("src", "wave-status", "cli.ts"),
      join("src", "wave-status", "lib", "collect.ts"),
      join("src", "wave-status", "lib", "derive.ts"),
      join("src", "wave-status", "lib", "lane-state.ts"),
      join("src", "wave-status", "lib", "merge.ts"),
      join("src", "wave-status", "lib", "render.ts"),
      join("src", "bins", "wave-status.ts"),
      join("public", "wave-status", "index.html"),
      join("__tests__", "wave-status", "bin.test.ts"),
      join("__tests__", "wave-status", "charter.test.ts"),
      join("__tests__", "wave-status", "cli.test.ts"),
      join("__tests__", "wave-status", "collect.test.ts"),
      join("__tests__", "wave-status", "page.test.ts"),
      join("__tests__", "wave-status", "pr-lane-join.test.ts"),
      join("__tests__", "wave-status", "server.test.ts"),
      join("__tests__", "wave-status", "lib", "derive.test.ts"),
      join("__tests__", "wave-status", "lib", "lane-state.test.ts"),
      join("__tests__", "wave-status", "lib", "merge.test.ts"),
      join("__tests__", "wave-status", "lib", "render.test.ts"),
      join(
        "__tests__",
        "wave-status",
        "fixtures",
        "pr-lane-join-synthetic.json",
      ),
    ]) {
      expect(files, expected).toContain(expected);
    }
  });

  test("no file carries a forbidden string", () => {
    const hits = sweep(files, FORBIDDEN);
    expect(
      hits.map((hit) => `${hit.file}:${hit.line} ${hit.label} — ${hit.text}`),
      hits.map((hit) => `${hit.file}:${hit.line} ${hit.text}`).join("\n"),
    ).toEqual([]);
  });

  test("3000 and 3001 appear only inside the two PORT cases", () => {
    const spans = new Map<string, (readonly [number, number])[]>();
    for (const { file, test } of PORT_EXCEPTIONS) {
      const list = spans.get(file) ?? [];
      list.push(
        spanOf(readFileSync(resolve(PACKAGE_ROOT, file), "utf8"), test),
      );
      spans.set(file, list);
    }
    // Each allowance must have found its case: an empty span means the test has
    // been renamed and the exception has quietly stopped applying.
    for (const { file, test } of PORT_EXCEPTIONS) {
      const [start] = spanOf(
        readFileSync(resolve(PACKAGE_ROOT, file), "utf8"),
        test,
      );
      expect(
        start,
        `${file}: the PORT exception "${test}" names no test`,
      ).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(resolve(PACKAGE_ROOT, file), "utf8");
      for (const match of text.matchAll(PORT_PATTERN)) {
        const line = text.slice(0, match.index ?? 0).split("\n").length;
        const allowed = (spans.get(file) ?? []).some(
          ([start, end]) => line >= start + 1 && line <= end + 1,
        );
        if (allowed) continue;
        hits.push(`${file}:${line} ${lineAt(text, match.index ?? 0).trim()}`);
      }
    }
    expect(hits, `a forbidden port literal:\n${hits.join("\n")}`).toEqual([]);
  });

  test("the two PORT exceptions are the cases they claim to be", () => {
    // A pattern that stopped matching would silently widen the exception above,
    // so the allowance itself is asserted: each named case really does exist, in
    // the file the exception names, and it really is about the number.
    for (const { file, test } of PORT_EXCEPTIONS) {
      const text = readFileSync(resolve(PACKAGE_ROOT, file), "utf8");
      expect(text, file).toContain(`test("${test}"`);
      expect(text, file).toMatch(/PORT: "3000"/);
    }
    // And both halves of the rule are present, in both files: the number allowed
    // because nothing forbids it, and refused because the file forbids it.
    const server = readFileSync(
      resolve(PACKAGE_ROOT, "__tests__/wave-status/server.test.ts"),
      "utf8",
    );
    expect(server).toMatch(/forbiddenPorts: \[\]/);
    expect(server).toMatch(/forbiddenPorts: \[3000, 3001\]/);
    const bin = readFileSync(
      resolve(PACKAGE_ROOT, "__tests__/wave-status/bin.test.ts"),
      "utf8",
    );
    expect(bin).toMatch(/forbiddenPorts: \[\]/);
    expect(bin).toMatch(/forbiddenPorts: \[3000, 3001\]/);
  });

  test("the port the tool serves is the overlay's own default, and it is one number", () => {
    // The only port this package names at all is its own, and it is named in the
    // shared config module — never in a bin, a page or a test of this lane.
    const config = readFileSync(
      resolve(PACKAGE_ROOT, "src/internal/config.ts"),
      "utf8",
    );
    expect(config).toMatch(/export const DEFAULT_WAVE_STATUS_PORT = (\d+);/);
    const [, port] =
      /export const DEFAULT_WAVE_STATUS_PORT = (\d+);/.exec(config) ?? [];
    expect(port).toBe("4318");
    const server = readFileSync(
      resolve(PACKAGE_ROOT, "src/wave-status/server.ts"),
      "utf8",
    );
    expect(server).toContain("DEFAULT_WAVE_STATUS_PORT");
    // And no literal port number in the server at all: it can only arrive
    // through `resolvePort`, which is the one place a refusal can happen.
    expect(portLiterals(server)).toEqual([]);
  });

  test("the port-literal check can fail: a planted 4317 is found, and hex colours, dotted addresses and underscored numbers are not", () => {
    expect(portLiterals("const port = 4317;")).toEqual(["4317"]);
    expect(portLiterals("listen(31337, host)")).toEqual(["31337"]);
    expect(portLiterals("color: #1234; x = 0x1F90; v = 10.4317.1")).toEqual([]);
    expect(portLiterals("const n = 4_317; const m = 12_345;")).toEqual([]);
    // The two legitimate literals, allow-listed by name below.
    expect(portLiterals("if (port > 65535 || kb > 1024) fail();")).toEqual([]);
  });
});
