/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { Project } from "ts-morph";
import yaml from "js-yaml";
import { getProjectRoot } from "./shared/project-root.js";
import { promptService } from "./shared/prompt-service.js";

interface WorkspaceInfo {
  name: string;
  dir: string;
  fullPath: string;
}

export async function bootstrapCommand(): Promise<void> {
  const root = getProjectRoot();
  console.log(`Bootstrapping HexaGen in ${root}...`);

  // 1. Find candidates
  const candidates: WorkspaceInfo[] = [];
  const packagesDir = path.join(root, "packages");
  const appsDir = path.join(root, "apps");

  for (const dir of [packagesDir, appsDir]) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          const pkgJsonPath = path.join(fullPath, "package.json");
          try {
            const pkgJsonStr = await fs.readFile(pkgJsonPath, "utf-8");
            const pkgJson = JSON.parse(pkgJsonStr);
            if (pkgJson.name) {
              candidates.push({
                name: pkgJson.name,
                dir: path.relative(root, fullPath),
                fullPath,
              });
            }
          } catch {
            // Ignore directories without package.json
          }
        }
      }
    } catch {
      // Ignore if packages or apps dir doesn't exist
    }
  }

  if (candidates.length === 0) {
    console.error("No workspaces found in packages/ or apps/.");
    return;
  }

  // 2. Interactively propose candidate contexts
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

  // 3. Read TS morph import graph to determine depends_on
  console.log("\nAnalyzing TS import graph for dependencies...");
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 99,
      module: 99,
    },
  });

  const contextMap = new Map<string, WorkspaceInfo>();
  selectedContexts.forEach((c) => contextMap.set(c.name, c));

  const dependencies = new Map<string, Set<string>>();
  selectedContexts.forEach((c) => dependencies.set(c.name, new Set()));

  for (const ctx of selectedContexts) {
    const srcDir = path.join(ctx.fullPath, "src");
    try {
      const stat = await fs.stat(srcDir);
      if (stat.isDirectory()) {
        project.addSourceFilesAtPaths(path.join(srcDir, "**/*.ts"));
      }
    } catch {
      // Ignore
    }
  }

  const sourceFiles = project.getSourceFiles();
  for (const file of sourceFiles) {
    const filePath = file.getFilePath();
    const ctx = selectedContexts.find((c) =>
      filePath.startsWith(c.fullPath + "/"),
    );
    if (!ctx) continue;

    const imports = file.getImportDeclarations();
    for (const imp of imports) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      if (contextMap.has(moduleSpecifier) && moduleSpecifier !== ctx.name) {
        dependencies.get(ctx.name)!.add(moduleSpecifier);
      }
    }
  }

  // 4. Emit manifest.yaml, layout.yaml, arch-lint-baseline.json
  const architectureDir = path.join(root, ".architecture");
  const manifestPath = path.join(architectureDir, "manifest.yaml");
  const layoutPath = path.join(architectureDir, "layout.yaml");
  const baselinePath = path.join(architectureDir, "arch-lint-baseline.json");

  await fs.mkdir(architectureDir, { recursive: true });

  const manifestData = {
    version: "1.0.0",
    bounded_contexts: selectedContexts.map((ctx) => {
      const deps = Array.from(dependencies.get(ctx.name) || []);
      const contextObj: Record<string, unknown> = {
        name: ctx.name.replace(/^@hexagen\//, ""),
        description: `Context for ${ctx.name}`,
        type: "core",
      };
      if (deps.length > 0) {
        contextObj.depends_on = deps.map((d) => d.replace(/^@hexagen\//, ""));
      }
      return contextObj;
    }),
    apps: selectedApps.map((app) => ({
      name: app.name.replace(/^@hexagen\//, ""),
      description: `App for ${app.name}`,
    })),
  };

  const yamlStr = yaml.dump(manifestData, { noRefs: true, sortKeys: true });
  await fs.writeFile(manifestPath, yamlStr, "utf-8");
  console.log(`Generated ${manifestPath}`);

  const layoutData = {
    version: "1.0.0",
    workspaces: {},
  };
  for (const ctx of selectedContexts) {
    const shortName = ctx.name.replace(/^@hexagen\//, "");
    (layoutData.workspaces as Record<string, string>)[shortName] = ctx.dir;
  }
  for (const app of selectedApps) {
    const shortName = app.name.replace(/^@hexagen\//, "");
    (layoutData.workspaces as Record<string, string>)[shortName] = app.dir;
  }

  const layoutYamlStr = yaml.dump(layoutData, { noRefs: true, sortKeys: true });
  await fs.writeFile(layoutPath, layoutYamlStr, "utf-8");
  console.log(`Generated ${layoutPath}`);

  const baselineData = {
    version: "1.0.0",
    suppressions: [],
  };
  await fs.writeFile(
    baselinePath,
    JSON.stringify(baselineData, null, 2),
    "utf-8",
  );
  console.log(`Generated ${baselinePath}`);

  console.log("\nBootstrap complete.");
}
