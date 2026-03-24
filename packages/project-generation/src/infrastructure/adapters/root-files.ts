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
      },
      devDependencies: {
        turbo: "^2.0.0",
        typescript: "^5.5.4",
        eslint: "^9.0.0",
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
