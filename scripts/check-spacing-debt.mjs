#!/usr/bin/env node
/**
 * Counted, shrink-only gate for `hexagen-ui/no-off-scale-spacing`.
 *
 * The rule is wired at `error` only for `apps/web/components/primitives/**`,
 * which measures zero violations. `features/**` and `components/**` carry
 * pre-existing debt and are wired at `warn` — and `turbo lint` exits 0 on
 * warnings, so a NEW off-scale utility in those scopes lands with a green
 * build. A warning-only check is not a gate.
 *
 * This is the gate. It counts what the rule reports in the warn scopes and
 * fails when a count exceeds its pin, which makes the debt shrink-only in the
 * same way `validate-ui-boundary.sh` pins its cross-slice imports.
 *
 * Two failure modes are treated as failures, not as passes:
 *
 *   1. A count ABOVE its pin — new debt.
 *   2. Discovery finding NO files at all. A gate that inspects an empty
 *      population reports success having checked nothing, which is exactly the
 *      defect this repository keeps rediscovering. If the glob, the config or
 *      the rule name ever drifts, this fails loudly rather than going quiet.
 *
 * A count BELOW its pin is a pass, with a message asking for the pin to be
 * lowered. It deliberately does not fail: making progress must never be the
 * thing that breaks the build. The pins are lowered by hand as debt is paid,
 * and the last one to reach zero should flip that scope to `error` and delete
 * its entry here.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const webRoot = path.join(repoRoot, "apps/web");
const RULE = "hexagen-ui/no-off-scale-spacing";

/**
 * Pinned debt. SHRINK ONLY — never raise a number here to make CI pass. Raising
 * one is the same as deleting the gate for that scope.
 */
const PINS = [
  { scope: "features", dir: "features", max: 245 },
  { scope: "components", dir: "components", max: 21 },
];

/**
 * These were 225 and 17, and were raised ONCE, deliberately.
 *
 * This is the one legitimate reason to raise a shrink-only pin, and it is
 * recorded here rather than done quietly, because "the number went up" and
 * "the number was raised to make CI pass" look identical in a diff.
 *
 * The debt did not grow. The LENS widened: both Tailwind rules previously
 * inspected string `Literal` nodes only, so classes built with backticks were
 * invisible to them. Teaching them `TemplateElement` surfaced 24 violations
 * that were always there -- e.g. `prose-p:my-1.5` in ChatMarkdown, inside a
 * template literal, off-scale the whole time.
 *
 * Every future movement is downward. If a count rises again, it is new debt.
 */

function reportFor(dir) {
  let raw;
  let failure = null;
  try {
    // `yarn eslint`, not `npx eslint`: npx will attempt a NETWORK INSTALL when
    // the binary is not resolvable, so a broken install becomes a slow,
    // confusing failure instead of an immediate one. yarn resolves from the
    // workspace or fails.
    raw = execFileSync("yarn", ["eslint", dir, "--format", "json"], {
      cwd: webRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // ESLint exits non-zero when it reports errors. That is not a failure of
    // THIS gate — stdout still holds the JSON, and an unrelated error in
    // another rule must not make the spacing count unknowable.
    //
    // But the same catch also sees a CRASH (a missing plugin dist, a config
    // error), where stdout is empty and the only evidence is on stderr. The
    // previous version coerced that to "" and threw a message naming neither
    // the exit code nor stderr — failing closed, correctly, while discarding
    // the one thing that explains why. This file's own header calls that the
    // defect the repo keeps rediscovering, so it should not have shipped in it.
    raw = error.stdout ?? "";
    failure = {
      status: error.status ?? "unknown",
      stderr: (error.stderr ?? "").toString().trim(),
    };
  }
  if (raw.trim() === "") {
    throw new Error(
      `eslint produced no output for ${dir} (exit ${failure?.status ?? "unknown"}).\n` +
        `stderr:\n${failure?.stderr || "<none captured>"}`,
    );
  }
  const files = JSON.parse(raw);
  const count = files.reduce(
    (n, file) =>
      n + file.messages.filter((message) => message.ruleId === RULE).length,
    0,
  );
  return { filesInspected: files.length, count };
}

let failed = false;
console.log(`Spacing debt (${RULE}), shrink-only:\n`);

for (const pin of PINS) {
  const { filesInspected, count } = reportFor(pin.dir);

  if (filesInspected === 0) {
    console.error(
      `  FAIL  ${pin.scope}: eslint inspected 0 files. The gate cannot pass ` +
        `by checking nothing — the glob, the config or the rule name has drifted.`,
    );
    failed = true;
    continue;
  }

  if (count > pin.max) {
    console.error(
      `  FAIL  ${pin.scope}: ${count} violations, pinned at ${pin.max} ` +
        `(+${count - pin.max}). Fix the new one; do not raise the pin.`,
    );
    failed = true;
  } else if (count < pin.max) {
    console.log(
      `  ok    ${pin.scope}: ${count} violations, pinned at ${pin.max} ` +
        `— debt shrank, lower the pin to ${count} to hold the ground.`,
    );
  } else {
    console.log(
      `  ok    ${pin.scope}: ${count} violations, at the pin ` +
        `(${filesInspected} files inspected).`,
    );
  }
}

if (failed) {
  console.error(
    "\nFAILED — off-scale spacing debt grew, or a scope inspected nothing.",
  );
  process.exit(1);
}
console.log("\nPASSED — no new off-scale spacing.");
