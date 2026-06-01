/**
 * Reads every template manifest from packages/template-engine/templates/<id>/
 * and emits TWO generated TS modules the wizard consumes instead of
 * hand-maintaining a duplicate of the manifest data (the catalog/manifest drift
 * that bit PR #109 — and that left 18 templates invisible in the wizard — is
 * exactly the class of issue this guards against):
 *
 *   1. template-questions-step/template-questions.generated.ts
 *        id -> questions[]   (the per-template questions step)
 *   2. add-ons-step/template-manifest.generated.ts
 *        id -> { id, name, description, requires, conflicts }
 *        (the add-ons selection catalog merges this with hand-curated
 *         presentation fields — see template-catalog.ts)
 *
 * Run via `yarn workspace web gen:template-questions`. The CI parity check runs
 * the same script with `--check` and fails if EITHER on-disk file diverges from
 * the manifest-derived output.
 *
 * A manifest whose `requires` names a template with no manifest is a hard error
 * (the wizard could never resolve the dependency). A dangling `conflicts` ref is
 * inert (you can't select a template that doesn't exist), so it only warns.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");
const TEMPLATES_DIR = path.join(
  REPO_ROOT,
  "packages",
  "template-engine",
  "templates",
);
const WIZARD_DIR = path.join(WEB_ROOT, "features", "project-wizard", "steps");
const QUESTIONS_OUT = path.join(
  WIZARD_DIR,
  "template-questions-step",
  "template-questions.generated.ts",
);
const MANIFEST_OUT = path.join(
  WIZARD_DIR,
  "add-ons-step",
  "template-manifest.generated.ts",
);

interface RawQuestion {
  id: string;
  type: string;
  prompt?: string;
  options?: string[];
  default?: unknown;
  required?: boolean;
  validation?: { pattern: string; message: string };
  derivedFrom?: string;
}

interface Manifest {
  id: string;
  name?: string;
  description?: string;
  requires?: string[];
  conflicts?: string[];
  questions?: RawQuestion[];
}

interface ManifestMeta {
  id: string;
  name: string;
  description: string;
  requires: string[];
  conflicts: string[];
}

async function readManifests(): Promise<Manifest[]> {
  const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
  const out: Manifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("__")) continue;
    const manifestPath = path.join(TEMPLATES_DIR, entry.name, "manifest.json");
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, "utf-8");
    } catch (error) {
      // A directory with no manifest.json is not a template — skip it. Any other
      // read failure (permissions, etc.) is a real problem, so surface it.
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw new Error(
        `[gen:template-questions] cannot read ${path.relative(REPO_ROOT, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      out.push(JSON.parse(raw) as Manifest);
    } catch (error) {
      // A present-but-malformed manifest must FAIL — silently skipping it would
      // drop the template from both generated outputs and defeat the parity guard.
      throw new Error(
        `[gen:template-questions] malformed manifest ${path.relative(REPO_ROOT, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return out;
}

/**
 * A `requires` referencing a template with no manifest can never be resolved by
 * the wizard — hard fail. A dangling `conflicts` ref is harmless (the target is
 * unselectable) but usually a typo, so warn.
 */
function validateReferences(manifests: Manifest[]): void {
  // Both generated outputs are keyed by id — two manifests sharing an id would
  // silently collapse to one (a template vanishing from the wizard). Reject it.
  const counts = new Map<string, number>();
  for (const m of manifests) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  const dups = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  if (dups.length > 0) {
    throw new Error(
      `[gen:template-questions] duplicate template ids (would collapse in the id-keyed output): ${dups.join(", ")}`,
    );
  }

  const ids = new Set(manifests.map((m) => m.id));
  const fatal: string[] = [];
  for (const m of manifests) {
    for (const dep of m.requires ?? []) {
      if (!ids.has(dep)) {
        fatal.push(`  ${m.id} requires "${dep}" — no template by that id`);
      }
    }
    for (const c of m.conflicts ?? []) {
      if (!ids.has(c)) {
        console.warn(
          `[gen:template-questions] WARN ${m.id} conflicts "${c}" — no template by that id (inert)`,
        );
      }
    }
  }
  if (fatal.length > 0) {
    throw new Error(
      `[gen:template-questions] dangling required dependencies:\n${fatal.join("\n")}`,
    );
  }
}

function questionsMap(manifests: Manifest[]): Record<string, RawQuestion[]> {
  const out: Record<string, RawQuestion[]> = {};
  for (const id of manifests.map((m) => m.id).sort()) {
    out[id] = manifests.find((m) => m.id === id)!.questions ?? [];
  }
  return out;
}

function metaMap(manifests: Manifest[]): Record<string, ManifestMeta> {
  const out: Record<string, ManifestMeta> = {};
  for (const id of manifests.map((m) => m.id).sort()) {
    const m = manifests.find((x) => x.id === id)!;
    out[id] = {
      id: m.id,
      name: m.name ?? m.id,
      description: m.description ?? "",
      requires: m.requires ?? [],
      conflicts: m.conflicts ?? [],
    };
  }
  return out;
}

async function renderQuestions(
  map: Record<string, RawQuestion[]>,
): Promise<string> {
  const banner = [
    "// AUTO-GENERATED — DO NOT EDIT BY HAND.",
    "// Regenerate via `yarn workspace web gen:template-questions`.",
    "// Source of truth: packages/template-engine/templates/<id>/manifest.json",
    "",
    'import type { TemplateQuestion } from "./types";',
    "",
    "export const TEMPLATE_QUESTIONS: Record<string, ReadonlyArray<TemplateQuestion>> = ",
  ].join("\n");
  const raw = banner + JSON.stringify(map, null, 2) + ";\n";
  return prettier.format(raw, {
    parser: "typescript",
    filepath: QUESTIONS_OUT,
  });
}

async function renderManifests(
  map: Record<string, ManifestMeta>,
): Promise<string> {
  const banner = [
    "// AUTO-GENERATED — DO NOT EDIT BY HAND.",
    "// Regenerate via `yarn workspace web gen:template-questions`.",
    "// Source of truth: packages/template-engine/templates/<id>/manifest.json",
    "",
    "export interface TemplateManifestMeta {",
    "  id: string;",
    "  name: string;",
    "  description: string;",
    "  requires: readonly string[];",
    "  conflicts: readonly string[];",
    "}",
    "",
    "export const TEMPLATE_MANIFESTS: Record<string, TemplateManifestMeta> = ",
  ].join("\n");
  const raw = banner + JSON.stringify(map, null, 2) + ";\n";
  return prettier.format(raw, { parser: "typescript", filepath: MANIFEST_OUT });
}

async function checkOne(outFile: string, generated: string): Promise<boolean> {
  let onDisk = "";
  try {
    onDisk = await fs.readFile(outFile, "utf-8");
  } catch {
    console.error(
      `[gen:template-questions] ${path.relative(REPO_ROOT, outFile)} does not exist — run \`yarn workspace web gen:template-questions\` first.`,
    );
    return false;
  }
  if (onDisk !== generated) {
    console.error(
      `[gen:template-questions] DRIFT DETECTED — ${path.relative(REPO_ROOT, outFile)} is out of sync with the manifests.`,
    );
    console.error(
      "  Run `yarn workspace web gen:template-questions` and commit the result.",
    );
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes("--check");
  const manifests = await readManifests();
  validateReferences(manifests);

  const questions = await renderQuestions(questionsMap(manifests));
  const meta = await renderManifests(metaMap(manifests));

  if (checkMode) {
    // Run BOTH checks (no && short-circuit) so a stale questions file doesn't
    // mask a stale manifest file — every drifted output is reported in one run.
    const okQuestions = await checkOne(QUESTIONS_OUT, questions);
    const okManifest = await checkOne(MANIFEST_OUT, meta);
    if (!okQuestions || !okManifest) process.exit(1);
    console.log("[gen:template-questions] in sync ✓");
    return;
  }

  await fs.mkdir(path.dirname(QUESTIONS_OUT), { recursive: true });
  await fs.writeFile(QUESTIONS_OUT, questions, "utf-8");
  await fs.mkdir(path.dirname(MANIFEST_OUT), { recursive: true });
  await fs.writeFile(MANIFEST_OUT, meta, "utf-8");
  console.log(
    `[gen:template-questions] wrote ${manifests.length} templates → ${path.relative(REPO_ROOT, QUESTIONS_OUT)} + ${path.relative(REPO_ROOT, MANIFEST_OUT)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
