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

export function generateLayerRules(scope: string): string {
  return `# HexaGen — Architectural Invariants
# Governs the dependency flow between layers and packages.

shared_kernel:
  package: "@${scope}/shared"
  allowed_in_all_layers: true

layers:
  domain:
    access_rule: "internal-only"
    allowed_imports: ["@${scope}/shared"]

  application:
    access_rule: "ports-only"
    allowed_imports: ["domain", "@${scope}/shared"]

  infrastructure:
    access_rule: "adapters"
    allowed_imports: ["domain", "application", "@${scope}/shared"]
`;
}

export function generateLinterConfig(scope: string): string {
  return `# Rules for @hexagen/arch-linter

global_whitelist:
  - "@${scope}/shared"
  - "@${scope}/shared/**"

test_double_rules:
  allowed_cross_package_imports: true
`;
}

export function generateGeneratorConfig(
  manifest: Record<string, unknown>,
): string {
  const contexts =
    (manifest.bounded_contexts as Array<Record<string, unknown>> | undefined) ??
    [];

  const ownershipEntries: string[] = [];
  for (const bc of contexts) {
    const bcName = bc.name as string;
    if (bcName === "shared") continue;

    const layers = bc.layers as Record<string, unknown> | undefined;
    const application = layers?.application as
      | Record<string, unknown>
      | undefined;
    const infrastructure = layers?.infrastructure as
      | Record<string, unknown>
      | undefined;

    const inPorts = (application?.ports as Record<string, unknown>)?.in as
      | string[]
      | undefined;
    const outPorts = (application?.ports as Record<string, unknown>)?.out as
      | string[]
      | undefined;
    const adapters = infrastructure?.adapters as string[] | undefined;

    for (const p of inPorts ?? []) {
      const name = p
        .replace(/\.in-port\.ts$/, "")
        .split(/[-.]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      ownershipEntries.push(`      ${name}: ${bcName}`);
    }
    for (const p of outPorts ?? []) {
      const name = p
        .replace(/\.out-port\.ts$/, "")
        .split(/[-.]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      ownershipEntries.push(`      ${name}: ${bcName}`);
    }
    for (const a of adapters ?? []) {
      const name = a
        .replace(/\.adapter\.ts$/, "")
        .split(/[-.]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
      ownershipEntries.push(`      ${name}: ${bcName}`);
    }
  }

  const ownershipBlock =
    ownershipEntries.length > 0
      ? ownershipEntries.join("\n")
      : "      # No ports declared";

  return `generator:
  version: "1.0"
  description: "Global invariants and safety rules"

  invariants:
    - name: composite-safety
      description: "Every tsconfig.json must contain paths: {} to override inherited source mappings."
      priority: critical
      failure: abort-and-cleanup

    - name: barrel-ownership-boundary
      description: "Barrels may only re-export types owned by the current bounded context."
      priority: critical
      failure: abort-and-cleanup

    - name: port-single-ownership
      description: "Each port interface belongs to exactly one bounded context."
      priority: critical
      failure: abort-and-cleanup

    - name: dependency-consistency
      description: "Every @hexagen/* import must have a matching entry in package.json."
      priority: high
      failure: abort

    - name: self-import-prevention
      description: "No package imports itself by name."
      priority: high
      failure: abort

    - name: signature-synchronization
      description: "Generated consumers must derive exact signatures from the canonical port."
      priority: high
      failure: abort

    - name: no-empty-stubs
      description: "No empty barrels (export {}) in src/."
      priority: medium
      failure: warn-and-continue

    - name: exports-field-mandatory
      description: "Every package.json must include a complete exports map."
      priority: medium
      failure: warn-and-continue

    - name: test-double-parity
      description: "Test doubles must implement the same interface as the canonical port."
      priority: medium
      failure: warn-and-continue

  bootstrap-sequence:
    - load-ownership-map
    - validate-port-ownership-map
    - generate-package-skeleton
    - enforce-tsconfig-paths-override
    - generate-exports-field
    - synchronize-signatures
    - validate-barrel-chain
    - enforce-dependency-consistency
    - final-composite-reference-check

  failure-behavior:
    critical: abort-and-cleanup
    high: abort
    medium: warn-and-continue

  ownership-registry:
    ports:
${ownershipBlock}
`;
}
