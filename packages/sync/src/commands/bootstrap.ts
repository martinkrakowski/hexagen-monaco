/* eslint-disable no-console */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Node, Project, type SourceFile } from "ts-morph";
import yaml from "js-yaml";
import { findWorkspaceRoot } from "./shared/project-root.js";
import { promptService } from "./shared/prompt-service.js";
import { err, ok, type Result } from "../domain/result.js";
import { sanitizeScope } from "../types/manifest/helpers.js";
import {
  DEFAULT_LAYOUT_LAYERS,
  LAYOUT_YAML_RELATIVE_PATH,
} from "../infrastructure/config/layout-schema.js";

export const ARCH_LINT_BASELINE_RELATIVE_PATH =
  ".architecture/arch-lint-baseline.json";

/** Empty ratchet baseline (ADR-0054) — numeric version + `entries`. */
export const EMPTY_ARCH_LINT_BASELINE = {
  version: 1,
  entries: [] as const,
};

export interface BootstrapOptions {
  force?: boolean;
}

interface WorkspaceInfo {
  name: string;
  dir: string;
  fullPath: string;
}

interface RootPackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

function isNodeErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

function asError(e: unknown, fallback: string): Error {
  return e instanceof Error ? e : new Error(fallback);
}

function posixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

/** ts-morph globs reject native Windows separators. */
export function toTsMorphGlob(absPath: string): string {
  return posixPath(absPath);
}

export function resolveWorkspaceSpecifier(
  specifier: string,
  packageNames: Iterable<string>,
): string | undefined {
  const names = [...packageNames].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      return name;
    }
  }
  return undefined;
}

export function collectModuleSpecifiers(file: SourceFile): string[] {
  const specs = new Set<string>();

  for (const imp of file.getImportDeclarations()) {
    specs.add(imp.getModuleSpecifierValue());
  }
  for (const exp of file.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (spec) specs.add(spec);
  }

  file.forEachDescendant((node) => {
    if (Node.isImportTypeNode(node)) {
      const arg = node.getArgument();
      if (Node.isLiteralTypeNode(arg)) {
        const literal = arg.getLiteral();
        if (Node.isStringLiteral(literal)) {
          specs.add(literal.getLiteralValue());
        }
      }
    }
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (expr.getText() !== "import") return;
      const [first] = node.getArguments();
      if (
        first &&
        (Node.isStringLiteral(first) ||
          Node.isNoSubstitutionTemplateLiteral(first))
      ) {
        specs.add(first.getLiteralText());
      }
    }
  });

  return [...specs];
}

export function deriveSystemAndScope(pkgName: string | undefined): {
  system: string;
  scope: string;
} {
  if (!pkgName || pkgName.trim().length === 0) {
    return { system: "generated-project", scope: "generated-project" };
  }
  if (pkgName.startsWith("@")) {
    const withoutAt = pkgName.slice(1);
    const slash = withoutAt.indexOf("/");
    if (slash === -1) {
      const scope = sanitizeScope(withoutAt);
      return { system: scope, scope };
    }
    const scope = sanitizeScope(withoutAt.slice(0, slash));
    const system = withoutAt.slice(slash + 1) || scope;
    return { system, scope };
  }
  const scope = sanitizeScope(pkgName);
  return { system: pkgName, scope };
}

function workspaceGlobs(pkg: RootPackageJson): Result<string[], Error> {
  const raw = pkg.workspaces;
  if (raw === undefined) {
    return ok(["packages/*", "apps/*"]);
  }
  if (Array.isArray(raw)) {
    return ok(raw);
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.packages)) {
    return ok(raw.packages);
  }
  return err(
    new Error(
      "Root package.json 'workspaces' must be a string array or { packages: string[] }",
    ),
  );
}

async function expandWorkspaceGlob(
  root: string,
  pattern: string,
): Promise<Result<string[], Error>> {
  if (
    pattern.includes("**") ||
    pattern.includes("{") ||
    pattern.includes("[")
  ) {
    return err(
      new Error(
        `Unsupported workspace pattern '${pattern}'. Bootstrap accepts 'dir/*' or a concrete directory.`,
      ),
    );
  }

  if (pattern.endsWith("/*")) {
    const dir = path.join(root, pattern.slice(0, -2));
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return ok(
        entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => path.join(dir, entry.name)),
      );
    } catch (e) {
      if (isNodeErrno(e) && e.code === "ENOENT") return ok([]);
      return err(
        asError(e, `Failed to read workspace directory for ${pattern}`),
      );
    }
  }

  const full = path.join(root, pattern);
  try {
    const stat = await fs.stat(full);
    return ok(stat.isDirectory() ? [full] : []);
  } catch (e) {
    if (isNodeErrno(e) && e.code === "ENOENT") return ok([]);
    return err(asError(e, `Failed to stat workspace path ${pattern}`));
  }
}

async function readJsonFile(filePath: string): Promise<Result<unknown, Error>> {
  try {
    return ok(JSON.parse(await fs.readFile(filePath, "utf-8")));
  } catch (e) {
    if (isNodeErrno(e) && e.code === "ENOENT") {
      return err(
        Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" }),
      );
    }
    return err(asError(e, `Failed to read ${filePath}`));
  }
}

export async function discoverWorkspaces(
  root: string,
): Promise<Result<WorkspaceInfo[], Error>> {
  const rootPkgResult = await readJsonFile(path.join(root, "package.json"));
  if (!rootPkgResult.success) {
    return err(
      new Error(
        `Cannot read root package.json: ${rootPkgResult.error.message}`,
      ),
    );
  }
  if (
    typeof rootPkgResult.value !== "object" ||
    rootPkgResult.value === null ||
    Array.isArray(rootPkgResult.value)
  ) {
    return err(new Error("Root package.json must be a JSON object"));
  }

  const rootPkg = rootPkgResult.value as RootPackageJson;
  const globs = workspaceGlobs(rootPkg);
  if (!globs.success) return globs;

  const candidates: WorkspaceInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of globs.value) {
    const expanded = await expandWorkspaceGlob(root, pattern);
    if (!expanded.success) return expanded;

    for (const fullPath of expanded.value) {
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);

      const pkgJsonPath = path.join(fullPath, "package.json");
      let pkgJsonStr: string;
      try {
        pkgJsonStr = await fs.readFile(pkgJsonPath, "utf-8");
      } catch (e) {
        if (isNodeErrno(e) && e.code === "ENOENT") continue;
        return err(asError(e, `Failed to read package.json in ${fullPath}`));
      }

      let pkgJson: { name?: unknown };
      try {
        pkgJson = JSON.parse(pkgJsonStr) as { name?: unknown };
      } catch (e) {
        return err(
          new Error(
            `Malformed package.json at ${pkgJsonPath}: ${asError(e, "invalid JSON").message}`,
          ),
        );
      }

      if (typeof pkgJson.name !== "string" || pkgJson.name.length === 0) {
        continue;
      }

      candidates.push({
        name: pkgJson.name,
        dir: posixPath(path.relative(root, fullPath)),
        fullPath,
      });
    }
  }

  return ok(candidates);
}

export async function scanWorkspaceSources(
  project: Project,
  workspaces: readonly WorkspaceInfo[],
): Promise<Result<void, Error>> {
  for (const ctx of workspaces) {
    const srcDir = path.join(ctx.fullPath, "src");
    try {
      const stat = await fs.stat(srcDir);
      if (!stat.isDirectory()) continue;
    } catch (e) {
      if (isNodeErrno(e) && e.code === "ENOENT") continue;
      return err(asError(e, `Failed to stat source directory ${srcDir}`));
    }

    try {
      project.addSourceFilesAtPaths(
        [".ts", ".tsx", ".mts", ".cts"].map((ext) =>
          toTsMorphGlob(path.join(srcDir, `**/*${ext}`)),
        ),
      );
    } catch (e) {
      return err(asError(e, `Failed to scan TypeScript sources in ${srcDir}`));
    }
  }
  return ok(undefined);
}

export function inferDependencies(
  sourceFiles: readonly SourceFile[],
  selectedContexts: readonly WorkspaceInfo[],
): Map<string, Set<string>> {
  const contextMap = new Map<string, WorkspaceInfo>();
  const dependencies = new Map<string, Set<string>>();
  for (const ctx of selectedContexts) {
    contextMap.set(ctx.name, ctx);
    dependencies.set(ctx.name, new Set());
  }

  for (const file of sourceFiles) {
    const filePath = posixPath(file.getFilePath());
    const ctx = selectedContexts.find((candidate) =>
      filePath.startsWith(`${posixPath(candidate.fullPath)}/`),
    );
    if (!ctx) continue;

    for (const specifier of collectModuleSpecifiers(file)) {
      const dep = resolveWorkspaceSpecifier(specifier, contextMap.keys());
      if (dep && dep !== ctx.name) {
        dependencies.get(ctx.name)!.add(dep);
      }
    }
  }

  return dependencies;
}

function existingBootstrapArtifacts(root: string): string[] {
  const paths = [
    path.join(root, ".architecture", "manifest.yaml"),
    path.join(root, ...LAYOUT_YAML_RELATIVE_PATH.split("/")),
    path.join(root, ...ARCH_LINT_BASELINE_RELATIVE_PATH.split("/")),
  ];
  return paths.filter((p) => existsSync(p));
}

export async function bootstrapCommand(
  options: BootstrapOptions = {},
): Promise<void> {
  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    throw new Error(
      "No workspace root found. Run from a directory whose package.json declares workspaces, or from an existing HexaGen project (.architecture/manifest.yaml).",
    );
  }
  console.log(`Bootstrapping HexaGen in ${root}...`);

  const existing = existingBootstrapArtifacts(root);
  if (existing.length > 0 && !options.force) {
    throw new Error(
      "Architecture artifacts already exist:\n" +
        existing.map((p) => `  - ${path.relative(root, p)}`).join("\n") +
        "\nRefusing to overwrite. Re-run with --force to replace them.",
    );
  }

  const discovered = await discoverWorkspaces(root);
  if (!discovered.success) {
    throw discovered.error;
  }
  const candidates = discovered.value;

  if (candidates.length === 0) {
    throw new Error(
      "No workspaces found. Check the root package.json workspaces field.",
    );
  }

  const selectedContexts: WorkspaceInfo[] = [];
  console.log("\nProposing contexts based on found workspaces:");
  for (const candidate of candidates) {
    if (candidate.dir.startsWith("apps/")) {
      continue;
    }

    let include = true;
    if (promptService.canPrompt()) {
      const answer = await promptService.ask(
        `Include ${candidate.name} (${candidate.dir}) as a Bounded Context? [Y/n]: `,
      );
      if (answer.toLowerCase() === "n") {
        include = false;
      }
    }
    if (include) {
      selectedContexts.push(candidate);
    }
  }

  const selectedApps: WorkspaceInfo[] = candidates.filter((c) =>
    c.dir.startsWith("apps/"),
  );

  console.log("\nAnalyzing TS import graph for dependencies...");
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 99,
      module: 99,
    },
  });

  const scan = await scanWorkspaceSources(project, selectedContexts);
  if (!scan.success) {
    throw scan.error;
  }

  const dependencies = inferDependencies(
    project.getSourceFiles(),
    selectedContexts,
  );

  const architectureDir = path.join(root, ".architecture");
  const manifestPath = path.join(architectureDir, "manifest.yaml");
  const layoutPath = path.join(root, ...LAYOUT_YAML_RELATIVE_PATH.split("/"));
  const baselinePath = path.join(
    root,
    ...ARCH_LINT_BASELINE_RELATIVE_PATH.split("/"),
  );

  const rootPkgRaw = await readJsonFile(path.join(root, "package.json"));
  const rootName =
    rootPkgRaw.success &&
    typeof rootPkgRaw.value === "object" &&
    rootPkgRaw.value !== null &&
    "name" in rootPkgRaw.value &&
    typeof (rootPkgRaw.value as { name?: unknown }).name === "string"
      ? (rootPkgRaw.value as { name: string }).name
      : undefined;
  const { system, scope } = deriveSystemAndScope(rootName);

  const manifestData = {
    system,
    scope,
    architecture: "modular-monolith",
    bounded_contexts: selectedContexts.map((ctx) => {
      const deps = Array.from(dependencies.get(ctx.name) || []);
      const contextObj: Record<string, unknown> = {
        name: ctx.name.replace(/^@[^/]+\//, ""),
        description: `Context for ${ctx.name}`,
        type: "core",
      };
      if (deps.length > 0) {
        contextObj.depends_on = deps.map((d) => d.replace(/^@[^/]+\//, ""));
      }
      return contextObj;
    }),
    apps: selectedApps.map((app) => ({
      name: app.name.replace(/^@[^/]+\//, ""),
      description: `App for ${app.name}`,
    })),
  };

  const layoutData = {
    layers: [...DEFAULT_LAYOUT_LAYERS],
    workspaces: {} as Record<string, string>,
  };
  for (const ctx of selectedContexts) {
    const shortName = ctx.name.replace(/^@[^/]+\//, "");
    layoutData.workspaces[shortName] = ctx.dir;
  }
  for (const app of selectedApps) {
    const shortName = app.name.replace(/^@[^/]+\//, "");
    layoutData.workspaces[shortName] = app.dir;
  }

  await fs.mkdir(architectureDir, { recursive: true });

  await fs.writeFile(
    manifestPath,
    yaml.dump(manifestData, { noRefs: true, sortKeys: true }),
    "utf-8",
  );
  console.log(`Generated ${manifestPath}`);

  await fs.writeFile(
    layoutPath,
    yaml.dump(layoutData, { noRefs: true, sortKeys: true }),
    "utf-8",
  );
  console.log(`Generated ${layoutPath}`);

  await fs.writeFile(
    baselinePath,
    `${JSON.stringify(EMPTY_ARCH_LINT_BASELINE, null, 2)}\n`,
    "utf-8",
  );
  console.log(`Generated ${baselinePath}`);

  console.log("\nBootstrap complete.");
}
