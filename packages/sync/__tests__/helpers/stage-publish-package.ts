import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/**
 * Shared fixture for tests that assert what `scripts/prepare-publish-package.js`
 * actually emits.
 *
 * Assertions about the publish transform are made against the REAL script rather
 * than against its source text: a regex over `RETAINED_FIELDS` can be satisfied
 * by a commented-out entry (or broken by a reformat) while the emitted manifest
 * says something else entirely. Staging a throwaway fixture and reading the
 * result back cannot be fooled either way.
 */

// Repo-root staging script (helpers → __tests__ → sync → packages → root).
const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/prepare-publish-package.js", import.meta.url),
);

export type StagedManifest = {
  name: string;
  version?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/**
 * Create a minimal publishable fixture (package.json + dist/), run the staging
 * script against it, and return the staged manifest. The temp dir is always
 * removed, including when the script exits non-zero.
 */
export async function stagePublishedManifest(
  name: string,
  extra: Record<string, unknown> = {},
): Promise<StagedManifest> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prepublish-fixture-"));
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(path.join(dir, "dist", "index.js"), "export {};\n");
  // Staging requires a package-local LICENSE.
  await fs.writeFile(path.join(dir, "LICENSE"), "FIXTURE-LICENSE\n");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name, version: "1.2.3", type: "module", ...extra },
      null,
      2,
    ),
  );
  try {
    execFileSync("node", [SCRIPT, dir], { stdio: "ignore" });
    return JSON.parse(
      await fs.readFile(path.join(dir, "publish", "package.json"), "utf8"),
    ) as StagedManifest;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
