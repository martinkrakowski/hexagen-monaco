import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../domain/index.js";
import type { TemplateManifest } from "../domain/index.js";

const DEFAULT_TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

export interface TemplateBundle {
  manifests: TemplateManifest[];
  /** "<templateId>/<pathRelativeToFilesDir>" → raw file content. */
  files: Record<string, string>;
}

/**
 * Reserved framework namespace under `templates/`: directories whose name starts
 * with `__` (today only `__example__`, the engine's end-to-end fixture) are
 * deliberately not shipped, even though they carry a valid manifest.json.
 */
const RESERVED_PREFIX = "__";

/**
 * What a shipping template's directory name looks like: the kebab-case id the
 * manifest schema documents (`TemplateManifest.id`). Every shipped template
 * already conforms, so anything else under `templates/` — a dot-directory of
 * tooling config, a `scratch-copy Backup/`, an editor folder — is a stray, not
 * a template, regardless of what it contains.
 */
const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function hasManifest(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, "manifest.json"));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err; // permissions / IO faults must surface, not read as "not a template"
  }
}

/**
 * The single authoritative answer to "which directories under `templates/` are
 * templates?".
 *
 * Everything under `templates/` reaches customers — it is copied verbatim into
 * the published CLI (`packages/sync` tsup `onSuccess` → `dist/templates/`) and
 * inlined into `template-bundle.generated.ts`. So the rule is positive ("a
 * template is a kebab-case directory holding a manifest.json") rather than a
 * list of things to skip, which can only ever be as complete as the last
 * surprise, and a candidate that satisfies neither half is reported by name
 * instead of being silently dropped: a non-template directory here is a mistake
 * someone made, and a silent skip would hide it until it shipped.
 *
 * Every enumeration of `templates/` must go through this function — the bundle
 * build and the template guard suite previously walked the same directory under
 * different rules, and that divergence is what let a stray directory through.
 */
export async function discoverTemplateIds(
  templatesDir: string = DEFAULT_TEMPLATES_DIR,
): Promise<string[]> {
  const entries = await fs.readdir(templatesDir, { withFileTypes: true });
  const ids: string[] = [];
  const strays: string[] = [];

  for (const e of entries) {
    // Only a directory can be read as a template id, so a stray *file* here
    // (README.md, .DS_Store) is harmless and ignored. `isDirectory()` is false
    // for a symlink to a directory — symlinks are not followed, matching the
    // lstat-based payload budget.
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(RESERVED_PREFIX)) continue;

    if (!TEMPLATE_ID.test(e.name)) {
      strays.push(`${e.name} — not a kebab-case template id`);
    } else if (!(await hasManifest(path.join(templatesDir, e.name)))) {
      strays.push(`${e.name} — no manifest.json`);
    } else {
      ids.push(e.name);
    }
  }

  if (strays.length > 0) {
    throw new Error(
      `${templatesDir} contains ${strays.length} director${
        strays.length === 1 ? "y" : "ies"
      } that ${strays.length === 1 ? "is" : "are"} not a template:\n  ` +
        strays.join("\n  ") +
        `\nEverything under templates/ ships to customers. Add a manifest.json to make ` +
        `it a template, rename it with the reserved "${RESERVED_PREFIX}" prefix if it is ` +
        `a fixture, or move it out of templates/ (tooling and editor config belongs at ` +
        `the repository root).`,
    );
  }

  // A build/guard that scans nothing must fail loudly, not pass vacuously.
  if (ids.length === 0) {
    throw new Error(`No templates discovered under ${templatesDir}`);
  }

  // Code-unit comparison (not localeCompare, which depends on the runtime's
  // locale/ICU data) so the committed bundle's key order is reproducible.
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function collectFiles(
  dir: string,
  filesDir: string,
  id: string,
  out: Record<string, string>,
): Promise<void> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []; // a template may have no files/ dir
      throw err;
    });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectFiles(full, filesDir, id, out);
    } else {
      const rel = path.relative(filesDir, full).split(path.sep).join("/");
      out[`${id}/${rel}`] = await fs.readFile(full, "utf-8");
    }
  }
}

/**
 * Read every template's manifest + `files/**` from disk into an in-memory
 * bundle, with deterministic key ordering. Used at generation time
 * (scripts/generate-template-bundle.ts) and by the parity test — NOT at runtime
 * (the web reads the generated module, which carries no filesystem dependency).
 */
export async function buildTemplateBundle(
  templatesDir: string = DEFAULT_TEMPLATES_DIR,
): Promise<TemplateBundle> {
  const ids = await discoverTemplateIds(templatesDir);

  const manifests: TemplateManifest[] = [];
  const files: Record<string, string> = {};

  for (const id of ids) {
    // Discovery already established the manifest exists, so an error here is a
    // real IO fault (or a concurrent edit) and must surface rather than quietly
    // dropping a template from the bundle.
    const raw = await fs.readFile(
      path.join(templatesDir, id, "manifest.json"),
      "utf-8",
    );
    manifests.push(validateManifest(JSON.parse(raw)));
    await collectFiles(
      path.join(templatesDir, id, "files"),
      path.join(templatesDir, id, "files"),
      id,
      files,
    );
  }

  // Code-unit comparison (not localeCompare, which depends on the runtime's
  // locale/ICU data) so the committed bundle's key order is reproducible across
  // machines — matches the id ordering discoverTemplateIds() returns.
  const sortedFiles = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return { manifests, files: sortedFiles };
}
