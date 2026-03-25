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
        dev: "turbo dev",
        lint: "turbo lint",
        typecheck: "turbo typecheck",
        test: "turbo test",
        clean: "turbo clean",
        sync: "hexagen sync",
        "sync:dry": "hexagen sync --dry-run",
        "sync:force": "hexagen sync --force",
        "lint:arch": "hexagen arch validate",
        format: 'prettier --write "**/*.{ts,tsx,md}"',
      },
      devDependencies: {
        turbo: "^2.0.0",
        typescript: "^5.5.4",
        eslint: "^9.0.0",
        prettier: "^3.0.0",
        "@hexagen/sync": "^0.1.0",
        "@hexagen/arch-linter": "^0.1.0",
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
        dev: { cache: false, persistent: true },
        lint: { dependsOn: ["^build"] },
        typecheck: { outputs: [], cache: true },
        test: { dependsOn: ["^build"] },
      },
    },
    null,
    2,
  );
}

export function generateAppStubContent(
  appName: string,
  appType: string,
): string {
  if (appType === "web") {
    return `// Auto-generated Next.js application
export default function HomePage() {
  return <div>Welcome to ${appName}</div>;
}
`;
  }

  if (appType === "api") {
    return `// Auto-generated Fastify application
import fastify from 'fastify';

const server = fastify();

server.get('/', async () => {
  return { status: 'ok' };
});

export default server;
`;
  }

  return `// Auto-generated application\n`;
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

export function generateEslintConfig(): string {
  return `import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
`;
}

export function generateBarrelContent(): string {
  return "export {};\n";
}
