export function generateRootPackageJson(systemName: string): string {
  return JSON.stringify(
    {
      name: systemName,
      private: true,
      type: "module",
      packageManager: "yarn@4.12.0",
      workspaces: ["apps/*", "packages/*"],
      scripts: {
        build: "turbo build",
        lint: "turbo lint",
        typecheck: "turbo typecheck",
        test: "turbo test",
      },
    },
    null,
    2,
  );
}

export function generateRootTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        composite: true,
        declaration: true,
        emitDeclarationOnly: true,
        paths: {
          "@hexagen/*": ["./packages/*/src/index.ts"],
        },
      },
    },
    null,
    2,
  );
}

export function generateRootTurboJson(): string {
  return JSON.stringify(
    {
      $schema: "https://turbo.build/schema.json",
      tasks: {
        build: { dependsOn: ["^build"], outputs: ["dist/**"] },
        lint: { dependsOn: ["^build"] },
        typecheck: { outputs: [], cache: true },
        test: { dependsOn: ["^build"] },
      },
    },
    null,
    2,
  );
}

export function generateStubContent(fileName: string): string {
  const isTsFile = fileName.endsWith(".ts") && !fileName.endsWith("index.ts");
  if (!isTsFile) return "// Auto-generated content\n";

  const interfaceName = fileName
    .replace(/\.ts$/, "")
    .split(/[-.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return `// Auto-generated stub\nexport interface ${interfaceName} {\n  // Implementation pending\n}\n`;
}
