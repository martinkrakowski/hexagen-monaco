#!/usr/bin/env node
// Derives the reference project's expected gate-step list from the pinned gate.sh snapshot.
//
// The snapshot is the left-hand side of the round-trip check OW8(b) runs: after
// `hexagen-orchestration-gate --print-steps` over a seeded overlay, the resolved step list has
// to equal this file, line for line. That check is only worth anything if this file is derived
// from the upstream gate rather than typed from the same reading as the config it is compared
// against — so it is derived here, and `config.yaml.gateSteps` is authored separately by hand.
// An error shared by both still fails the comparison; an error shared by construction never
// would.
//
// Two kinds of difference between the upstream gate and the packaged gate are applied by
// mapping, and the mapping is written out below rather than folded into the parse:
//
//   * `check:env` is a conditional no-op upstream. Its upstream command is the name of a shell
//     function, not something a consumer can run, so it maps to the project's own script. The
//     packaged gate reports it `SKIPPED` when the project has no such script, and only a step
//     the config marks `optional: true` may skip.
//   * `verify-manifests` is a path into the upstream repository. The packaged gate calls the
//     package's own binary instead, which is the whole reason the step is in the list at all.
//
// Two steps are dropped, and dropping them is a decision rather than an omission:
// `arch:inventory` is excluded from the port, and the route-scan guard is a framework
// route-registry check with no generic equivalent. Neither has a packaged equivalent, and a
// step list that named them would ask a consumer's gate to run something that cannot exist.
//
// Usage: node scripts/orchestration/extract-gate-steps.mjs <path-to-source-gate.sh> [<out.tsv>]

import { readFileSync, writeFileSync } from "node:fs";

const EXCLUDED = new Set(["arch:inventory", "nitro-route-scan"]);

const REMAP = new Map([
  ["check:env", "yarn check:env"],
  ["verify-manifests", "hexagen-orchestration-verify-manifests"],
]);

const ADD_STEP = /^\s*add_step\s+"([^"]+)"\s+"((?:[^"\\]|\\.)*)"\s*$/;

// The upstream gate's own count of steps, and the line range they occupy. Both are asserted so
// a snapshot that no longer matches the pin this was written against fails loudly here instead
// of quietly producing a shorter list.
const EXPECTED_CALLS = 13;

function die(message) {
  process.stderr.write(`extract-gate-steps: ${message}\n`);
  process.exit(2);
}

function extract(gateSh) {
  const calls = [];
  gateSh.split("\n").forEach((line, index) => {
    const match = line.match(ADD_STEP);
    if (match) calls.push({ name: match[1], command: match[2], line: index + 1 });
  });
  if (calls.length !== EXPECTED_CALLS) {
    die(`expected ${EXPECTED_CALLS} add_step calls in the snapshot, found ${calls.length}`);
  }
  return calls
    .filter((call) => !EXCLUDED.has(call.name))
    .map((call) => ({ name: call.name, command: REMAP.get(call.name) ?? call.command }));
}

const [sourcePath, outPath] = process.argv.slice(2);
if (!sourcePath) die("usage: extract-gate-steps.mjs <path-to-source-gate.sh> [<out.tsv>]");

let gateSh;
try {
  gateSh = readFileSync(sourcePath, "utf8");
} catch {
  die(`cannot read ${sourcePath}`);
}

const steps = extract(gateSh);
const tsv = steps.map((step) => `${step.name}\t${step.command}`).join("\n") + "\n";

if (outPath) {
  try {
    writeFileSync(outPath, tsv);
  } catch {
    die(`cannot write ${outPath}`);
  }
} else {
  process.stdout.write(tsv);
}
