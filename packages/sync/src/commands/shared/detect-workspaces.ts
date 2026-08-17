import { promises as fs } from "node:fs";
import path from "node:path";

export interface DetectedPackage {
  name: string;
  root: string;
  packageName?: string;
  layers: Partial<
    Record<
      "domain" | "application" | "infrastructure" | "presentation",
      string[]
    >
  >;
}

export interface WorkspaceDetection {
  system: string;
  packages: DetectedPackage[];
}

const LAYER_ALIASES: Record<
  "domain" | "application" | "infrastructure" | "presentation",
  string[]
> = {
  domain: ["src/domain", "src/core"],
  application: ["src/application", "src/services"],
  infrastructure: ["src/infrastructure", "src/db", "src/http", "src/adapters"],
  presentation: ["src/presentation", "src/ui"],
};

type PackageJson = {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
};

function workspaceGlobs(pkg: PackageJson): string[] {
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    return pkg.workspaces.packages;
  }
  return [];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function expandGlob(root: string, glob: string): Promise<string[]> {
  if (glob.endsWith("/*") && !glob.slice(0, -2).includes("*")) {
    const dir = path.join(root, glob.slice(0, -2));
    if (!(await pathExists(dir))) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => path.join(glob.slice(0, -2), e.name));
  }
  if (glob.includes("*")) {
    throw new Error(
      `Complex globs like '${glob}' are not supported. Only simple trailing '/*' globs are currently supported.`,
    );
  }
  const abs = path.join(root, glob);
  return (await pathExists(abs)) ? [glob] : [];
}

async function detectLayers(
  absRoot: string,
): Promise<DetectedPackage["layers"]> {
  const layers: DetectedPackage["layers"] = {};
  for (const [layer, candidates] of Object.entries(LAYER_ALIASES) as [
    keyof typeof LAYER_ALIASES,
    string[],
  ][]) {
    const found: string[] = [];
    for (const candidate of candidates) {
      if (await pathExists(path.join(absRoot, candidate))) {
        found.push(candidate);
      }
    }
    if (found.length > 0) layers[layer] = found;
  }
  return layers;
}

function contextNameFrom(pkgName: string | undefined, dirName: string): string {
  if (pkgName && pkgName.includes("/")) return pkgName.split("/")[1] ?? dirName;
  if (pkgName && !pkgName.startsWith("@")) return pkgName;
  return dirName;
}

export async function detectWorkspaces(
  root: string,
): Promise<WorkspaceDetection> {
  const pkgPath = path.join(root, "package.json");
  let pkg: PackageJson = {};
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as PackageJson;
  } catch {
    pkg = {};
  }

  const globs = workspaceGlobs(pkg);
  const relRoots =
    globs.length > 0
      ? (await Promise.all(globs.map((g) => expandGlob(root, g)))).flat()
      : [];

  // A non-workspace repo still has itself as a candidate.
  const candidates = relRoots.length > 0 ? relRoots : ["."];
  const packages: DetectedPackage[] = [];
  const seenNames = new Set<string>();

  for (const rel of candidates) {
    const abs = path.join(root, rel);
    let packageName: string | undefined;
    try {
      const child = JSON.parse(
        await fs.readFile(path.join(abs, "package.json"), "utf8"),
      ) as PackageJson;
      packageName = child.name;
    } catch {
      packageName = undefined;
    }
    const dirName = rel === "." ? path.basename(root) : path.basename(rel);
    const name = contextNameFrom(packageName, dirName);

    if (seenNames.has(name)) {
      throw new Error(
        `Duplicate context name '${name}' detected. Ensure packages have unique unscoped names or different directory names.`,
      );
    }
    seenNames.add(name);

    packages.push({
      name,
      root: rel === "." ? "." : rel.split(path.sep).join("/"),
      packageName,
      layers: await detectLayers(abs),
    });
  }

  const system =
    typeof pkg.name === "string" && pkg.name.length > 0
      ? pkg.name.replace(/^@[^/]+\//, "")
      : path.basename(root);

  return { system, packages };
}
