import { readFileSync, readdirSync } from "node:fs";

/**
 * Pre-flight env check. A var declared with an empty value (e.g. `XAI_API_KEY=`)
 * in ANY committed example file — `.env.example` plus the per-template
 * `.env.<name>.example` files that templates ship — is treated as REQUIRED and
 * must have a non-empty value in .env.local (or the process environment).
 * Exits 1 if any are missing, so it can gate a demo, CI run, or deploy.
 * Run with: npm run check:env
 */

function parseEnv(contents: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const eq = line.indexOf("=");
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
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

// All committed env reference files: .env.example plus per-template
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

// A key is required if it has an empty value in ANY example file.
const required = new Set<string>();
for (const file of exampleFiles()) {
  for (const [key, value] of parseEnv(readFileSafe(file))) {
    if (value.length === 0) required.add(key);
  }
}

const local = parseEnv(readFileSafe(".env.local"));

const missing = [...required]
  .filter((key) => {
    const value = local.get(key) ?? process.env[key] ?? "";
    return value.trim().length === 0;
  })
  .sort();

if (missing.length > 0) {
  const list = missing.map((key) => "  - " + key).join("\n");
  console.error("\nMissing required env vars:\n" + list + "\n");
  process.exit(1);
}

console.log("All required env vars are set.");
