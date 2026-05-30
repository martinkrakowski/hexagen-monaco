import { readFileSync } from "node:fs";

/**
 * Pre-flight env check. A var declared with an empty value in .env.example
 * (e.g. `XAI_API_KEY=`) is treated as REQUIRED and must have a non-empty value
 * in .env.local (or the process environment). Exits 1 if any are missing, so it
 * can gate a demo, CI run, or deploy. Run with: npm run check:env
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

const example = parseEnv(readFileSafe(".env.example"));
const local = parseEnv(readFileSafe(".env.local"));

const missing: string[] = [];
for (const [key, exampleValue] of example) {
  // A non-empty example value is a sane default → the var is optional.
  if (exampleValue.length > 0) continue;
  const value = local.get(key) ?? process.env[key] ?? "";
  if (value.trim().length === 0) missing.push(key);
}

if (missing.length > 0) {
  const list = missing.map((key) => "  - " + key).join("\n");
  console.error("\nMissing required env vars:\n" + list + "\n");
  process.exit(1);
}

console.log("All required env vars are set.");
