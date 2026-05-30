import { readFileSync, readdirSync } from "node:fs";

/**
 * Pre-flight env check.
 *
 * A variable is REQUIRED when its line in any committed example file carries a
 * `# required` annotation, e.g.:
 *
 *   XAI_API_KEY=          # required (get one at https://console.x.ai)
 *
 * Required vars must have a non-empty value in .env.local (or the process
 * environment). Exits 1 if any are missing, so it can gate a demo, CI run, or
 * deploy. Run with: npm run check:env
 *
 * Requiredness is explicit (the annotation), NOT inferred from an empty value —
 * many templates ship optional, intentionally-empty placeholders (e.g. one API
 * key per provider where you only need one), and those must not be forced.
 * All committed example files are scanned: `.env.example` plus the per-template
 * `.env.<name>.example` files.
 */

interface EnvEntry {
  value: string;
  required: boolean;
}

function parseEnv(contents: string): Map<string, EnvEntry> {
  const out = new Map<string, EnvEntry>();
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const afterEq = line.slice(eq + 1);

    // Split off an inline comment: the first '#' at the start of the value or
    // preceded by whitespace. A '#' inside the value (no leading space) is kept.
    const commentStart = afterEq.search(/(^|\s)#/);
    const hashIndex =
      commentStart >= 0 ? afterEq.indexOf("#", commentStart) : -1;
    const value = (hashIndex >= 0 ? afterEq.slice(0, hashIndex) : afterEq).trim();
    const comment = hashIndex >= 0 ? afterEq.slice(hashIndex + 1).trim() : "";

    out.set(key, { value, required: /^required\b/i.test(comment) });
  }
  return out;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// Committed env reference files: .env.example plus per-template
// .env.<name>.example files (never .env.local). Sorted for deterministic output.
function exampleFiles(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(".");
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(".env") && name.endsWith(".example"))
    .sort();
}

const required = new Set<string>();
for (const file of exampleFiles()) {
  for (const [key, entry] of parseEnv(readFileSafe(file))) {
    if (entry.required) required.add(key);
  }
}

const local = parseEnv(readFileSafe(".env.local"));

const missing = [...required]
  .filter((key) => {
    const value = local.get(key)?.value ?? process.env[key] ?? "";
    return value.trim().length === 0;
  })
  .sort();

if (missing.length > 0) {
  const list = missing.map((key) => "  - " + key).join("\n");
  console.error("\nMissing required env vars:\n" + list + "\n");
  process.exit(1);
}

console.log("All required env vars are set.");
