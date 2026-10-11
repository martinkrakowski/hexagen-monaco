import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAMED_LEGS = {
  web: ["web"],
  sync: ["@hexagen/sync"],
  orchestration: ["@hexagen/orchestration"],
  "template-engine": ["@hexagen/template-engine"],
  "arch-linter": ["@hexagen/arch-linter"],
};

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKSPACE_PATTERN = /^[^/*]+\/\*$/;

function readRootWorkspaces() {
  const rootPackageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const patterns = rootPackageJson.workspaces;
  if (!Array.isArray(patterns)) {
    console.error("The root package.json has no workspaces array.");
    process.exit(2);
  }
  for (const pattern of patterns) {
    if (!WORKSPACE_PATTERN.test(pattern)) {
      console.error(
        `Unexpected workspace pattern "${pattern}" in the root package.json: every pattern must have the shape "<dir>/*".`,
      );
      process.exit(2);
    }
  }
  return patterns;
}

function collectWorkspaces(patterns) {
  const workspaces = [];
  for (const pattern of patterns) {
    const parentDir = path.join(REPO_ROOT, pattern.slice(0, -1));
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspaceDir = path.join(parentDir, entry.name);
      if (!existsSync(path.join(workspaceDir, "package.json"))) continue;
      if (path.resolve(workspaceDir) === path.resolve(REPO_ROOT)) {
        console.error(
          "The root workspace was collected as a leg package; the root test script would run the whole suite inside one leg.",
        );
        process.exit(2);
      }
      const pkg = JSON.parse(
        readFileSync(path.join(workspaceDir, "package.json"), "utf8"),
      );
      workspaces.push({
        name: pkg.name,
        dir: workspaceDir,
        hasTest: typeof pkg.scripts?.test === "string",
      });
    }
  }
  return workspaces;
}

export function computeLegs(workspaces, namedLegs) {
  const errors = [];
  const byName = new Map(workspaces.map((ws) => [ws.name, ws]));
  const claimedBy = new Map();
  const legs = [];

  for (const [leg, names] of Object.entries(namedLegs)) {
    const packages = [];
    for (const name of names) {
      const ws = byName.get(name);
      if (!ws) {
        errors.push(
          `The leg "${leg}" lists the package "${name}", which does not exist.`,
        );
        continue;
      }
      if (!ws.hasTest) {
        errors.push(
          `The leg "${leg}" lists the package "${name}", which has no test script.`,
        );
        continue;
      }
      const owners = claimedBy.get(name) ?? [];
      if (owners.length > 0) {
        errors.push(
          `The package "${name}" is listed in both the legs "${owners[0]}" and "${leg}".`,
        );
      }
      owners.push(leg);
      claimedBy.set(name, owners);
      if (!packages.includes(name)) packages.push(name);
    }
    if (packages.length === 0) {
      errors.push(`The leg "${leg}" is empty.`);
    }
    legs.push({ leg, packages });
  }

  const rest = workspaces
    .filter((ws) => ws.hasTest && !claimedBy.has(ws.name))
    .map((ws) => ws.name)
    .sort();
  if (rest.length === 0) {
    errors.push('The leg "rest" is empty.');
  }
  legs.push({ leg: "rest", packages: rest });

  const membership = new Map();
  for (const leg of legs) {
    for (const name of leg.packages) {
      const owners = membership.get(name) ?? [];
      owners.push(leg.leg);
      membership.set(name, owners);
    }
  }
  for (const ws of workspaces) {
    if (!ws.hasTest) continue;
    const owners = membership.get(ws.name) ?? [];
    if (owners.length === 0) {
      errors.push(
        `The package "${ws.name}" has a test script but is in no leg.`,
      );
    } else if (owners.length > 1) {
      errors.push(
        `The package "${ws.name}" with a test script is in more than one leg (${owners.join(", ")}).`,
      );
    }
  }

  return { legs, errors };
}

export function toMatrix(legs) {
  return {
    include: legs.map((leg) => ({
      leg: leg.leg,
      filters: leg.packages.map((name) => `--filter=${name}`).join(" "),
    })),
  };
}

function printCheckTable(legs) {
  const width = Math.max("total".length, ...legs.map((l) => l.leg.length));
  let total = 0;
  for (const leg of legs) {
    total += leg.packages.length;
    console.log(
      `${leg.leg.padEnd(width)}  ${String(leg.packages.length).padStart(2)}  ${leg.packages.join(" ")}`,
    );
  }
  console.log(`${"total".padEnd(width)}  ${String(total).padStart(2)}`);
}

function yarnTestWorkspaces() {
  const output = execFileSync("yarn", ["workspaces", "list", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const names = new Set();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const { location, name } = JSON.parse(trimmed);
    if (location === ".") continue;
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, location, "package.json"), "utf8"),
    );
    if (typeof pkg.scripts?.test === "string") names.add(name);
  }
  return names;
}

function main() {
  const flag = process.argv[2];
  if (flag !== "--matrix" && flag !== "--check") {
    console.error("Usage: node scripts/ci/test-legs.mjs --matrix | --check");
    process.exit(2);
  }
  const patterns = readRootWorkspaces();
  const workspaces = collectWorkspaces(patterns);
  const { legs, errors } = computeLegs(workspaces, NAMED_LEGS);

  if (flag === "--matrix") {
    if (errors.length > 0) {
      for (const error of errors) console.error(error);
      process.exit(1);
    }
    console.log(JSON.stringify(toMatrix(legs)));
    return;
  }

  printCheckTable(legs);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }

  const yarnNames = yarnTestWorkspaces();
  const legNames = new Set(legs.flatMap((leg) => leg.packages));
  const missingFromLegs = [...yarnNames]
    .filter((name) => !legNames.has(name))
    .sort();
  const missingFromYarn = [...legNames]
    .filter((name) => !yarnNames.has(name))
    .sort();
  if (missingFromLegs.length > 0) {
    console.error(
      `Packages with a test script that no leg covers: ${missingFromLegs.join(", ")}.`,
    );
  }
  if (missingFromYarn.length > 0) {
    console.error(
      `Leg packages that yarn does not report as having a test script: ${missingFromYarn.join(", ")}.`,
    );
  }
  if (missingFromLegs.length > 0 || missingFromYarn.length > 0) {
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
