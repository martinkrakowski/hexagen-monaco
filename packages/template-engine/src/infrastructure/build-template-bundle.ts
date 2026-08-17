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
 * Templates that are deliberately not shipped: real templates, carrying a real
 * manifest.json, that exist for the engine's own tests. Today that is only
 * `__example__`, the end-to-end fixture.
 *
 * This is a **closed set of names, not a `__` prefix rule.** A prefix rule is an
 * open-ended skip list wearing a namespace costume: any directory could opt out
 * of every check in this file just by being named `__something`, and since
 * `templates/` is copied verbatim into the published CLI, opting out of the
 * check is opting into the tarball. Adding a fixture is therefore a deliberate
 * edit here, visible in a diff, rather than a directory nobody reviews.
 */
const RESERVED_TEMPLATE_DIRS: ReadonlySet<string> = new Set(["__example__"]);

/** Names that *look* reserved, so the stray report can say why they are not. */
const RESERVED_PREFIX = "__";

/**
 * What a shipping template's directory name looks like: the kebab-case id the
 * manifest schema documents (`TemplateManifest.id`). Every shipped template
 * already conforms, so anything else under `templates/` — a dot-directory of
 * tooling config, a `scratch-copy Backup/`, an editor folder — is a stray, not
 * a template, regardless of what it contains.
 */
const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Whether `<dir>/manifest.json` is a regular file, i.e. something
 * `buildTemplateBundle` can actually read.
 *
 * `fs.stat` succeeds for a *directory* named `manifest.json`, so an
 * existence-only check accepts the entry and the builder then dies on `EISDIR`
 * further downstream, naming a path instead of the mistake. `lstat` rather than
 * `stat` so a symlinked manifest is reported here too, under the same
 * no-symlinks-under-`templates/` rule discovery applies to every other entry.
 */
async function manifestState(
  dir: string,
): Promise<"file" | "missing" | "not-a-file"> {
  try {
    const stats = await fs.lstat(path.join(dir, "manifest.json"));
    return stats.isFile() ? "file" : "not-a-file";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
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
 *
 * Every entry is validated, including the reserved fixtures in
 * {@link RESERVED_TEMPLATE_DIRS}: those are withheld from the returned ids
 * *after* being checked, never exempted from the check. Nothing under
 * `templates/` can escape the rule by how it is named, and nothing is ignored —
 * a stray file or symlink is reported too, because a verbatim copy ships what it
 * is handed rather than what this function returns.
 */
export async function discoverTemplateIds(
  templatesDir: string = DEFAULT_TEMPLATES_DIR,
): Promise<string[]> {
  const entries = await fs.readdir(templatesDir, { withFileTypes: true });
  const ids: string[] = [];
  const strays: string[] = [];

  for (const e of entries) {
    // A symlink is checked first, because isDirectory()/isFile() are both false
    // for one and it would otherwise fall through unreported. A link is not
    // payload: it names a target that need not even live under templates/, so
    // it is a way to put content in the shipped directory that no check here
    // ever looks at.
    if (e.isSymbolicLink()) {
      strays.push(
        `${e.name} — a symlink; templates/ holds literal payload only`,
      );
      continue;
    }
    // A stray *file* cannot be read as a template id, but `templates/` is copied
    // verbatim into the published CLI, so an ignored file is not a harmless file
    // — it is a shipped one. Nothing lives here but templates.
    if (!e.isDirectory()) {
      strays.push(`${e.name} — a file, not a template directory`);
      continue;
    }

    // A reserved fixture is still a template and is still validated as one; it
    // is simply withheld from the returned ids. Nothing gets to skip validation
    // by how it is named — that is the hole this function exists to close.
    const reserved = RESERVED_TEMPLATE_DIRS.has(e.name);

    if (!reserved && !TEMPLATE_ID.test(e.name)) {
      strays.push(
        e.name.startsWith(RESERVED_PREFIX)
          ? `${e.name} — reserved "${RESERVED_PREFIX}" prefix, but not one of the ` +
              `known fixtures (${[...RESERVED_TEMPLATE_DIRS].join(", ")})`
          : `${e.name} — not a kebab-case template id`,
      );
      continue;
    }

    const manifest = await manifestState(path.join(templatesDir, e.name));
    if (manifest === "missing") {
      strays.push(`${e.name} — no manifest.json`);
    } else if (manifest === "not-a-file") {
      strays.push(`${e.name} — manifest.json is not a regular file`);
    } else if (!reserved) {
      ids.push(e.name);
    }
  }

  if (strays.length > 0) {
    throw new Error(
      `${templatesDir} contains ${strays.length} entr${
        strays.length === 1 ? "y" : "ies"
      } that ${strays.length === 1 ? "is" : "are"} not a template:\n  ` +
        strays.join("\n  ") +
        `\nEverything under templates/ ships to customers — the published CLI copies ` +
        `this directory verbatim, so anything ignored here is shipped, not skipped. ` +
        `Make it a kebab-case directory with a manifest.json, or move it out of ` +
        `templates/ (tooling, editor config and notes belong at the repository root). ` +
        `A fixture that must live here but must not ship has to be named in ` +
        `RESERVED_TEMPLATE_DIRS in build-template-bundle.ts; a "${RESERVED_PREFIX}" ` +
        `prefix on its own exempts nothing.`,
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
    // Same no-symlinks rule discovery applies at the top level, enforced here
    // because this is where the divergence bit: `readFile` dereferences a link
    // and inlines the *target's* bytes into the bundle, while the payload-budget
    // guard measures the link itself with `lstat`. A 1 MB file behind a symlink
    // was measured as 80 bytes — the budget cannot enforce what it cannot see.
    if (e.isSymbolicLink()) {
      throw new Error(
        `${full} is a symlink. templates/ holds literal payload only: readFile ` +
          `would inline the link target's bytes into the bundle while the payload ` +
          `budget measures only the link. Replace it with a real file.`,
      );
    }
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
