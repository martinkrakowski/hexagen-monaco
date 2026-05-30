/* eslint-disable no-console */
/**
 * Reads every template manifest from packages/template-engine/templates/<id>/
 * and emits a TS module mapping template id → questions[]. The wizard's
 * per-template questions step imports this generated file rather than
 * hand-maintaining a duplicate of the manifest data — the catalog/manifest
 * drift that bit PR #109 is the kind of issue this guards against.
 *
 * Run via `yarn workspace web gen:template-questions`. The CI parity check
 * runs the same script with `--check` and fails if the on-disk file diverges
 * from the manifest-derived output.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");
const TEMPLATES_DIR = path.join(
  REPO_ROOT,
  "packages",
  "template-engine",
  "templates",
);
const OUT_FILE = path.join(
  WEB_ROOT,
  "features",
  "project-wizard",
  "steps",
  "template-questions-step",
  "template-questions.generated.ts",
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

async function readManifests(): Promise<Record<string, RawQuestion[]>> {
  const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
  const out: Record<string, RawQuestion[]> = {};
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("__")) continue;
    const manifestPath = path.join(TEMPLATES_DIR, entry.name, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        id: string;
        questions?: RawQuestion[];
      };
      out[parsed.id] = parsed.questions ?? [];
    } catch {
      // Skip directories without a valid manifest (no template).
    }
  }
  return out;
}

function render(map: Record<string, RawQuestion[]>): string {
  const banner = [
    "// AUTO-GENERATED — DO NOT EDIT BY HAND.",
    "// Regenerate via `yarn workspace web gen:template-questions`.",
    "// Source of truth: packages/template-engine/templates/<id>/manifest.json",
    "",
    'import type { TemplateQuestion } from "./types";',
    "",
    "export const TEMPLATE_QUESTIONS: Record<string, ReadonlyArray<TemplateQuestion>> = ",
  ].join("\n");
  const ids = Object.keys(map).sort();
  const ordered: Record<string, RawQuestion[]> = {};
  for (const id of ids) ordered[id] = map[id];
  return banner + JSON.stringify(ordered, null, 2) + ";\n";
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes("--check");
  const map = await readManifests();
  const generated = render(map);

  if (checkMode) {
    let onDisk = "";
    try {
      onDisk = await fs.readFile(OUT_FILE, "utf-8");
    } catch {
      console.error(
        `[gen:template-questions] ${OUT_FILE} does not exist — run \`yarn workspace web gen:template-questions\` first.`,
      );
      process.exit(1);
    }
    if (onDisk !== generated) {
      console.error(
        "[gen:template-questions] DRIFT DETECTED — template-questions.generated.ts is out of sync with the manifests.",
      );
      console.error(
        "  Run `yarn workspace web gen:template-questions` and commit the result.",
      );
      process.exit(1);
    }
    console.log("[gen:template-questions] in sync ✓");
    return;
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, generated, "utf-8");
  console.log(
    `[gen:template-questions] wrote ${Object.keys(map).length} templates → ${path.relative(REPO_ROOT, OUT_FILE)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
