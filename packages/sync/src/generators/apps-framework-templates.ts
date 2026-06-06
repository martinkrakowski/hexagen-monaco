import type {
  AppFramework,
  AppFrameworkConfig,
  TsConfigTemplate,
} from "../types/manifest.js";

const NEXTJS_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

const NEXTJS_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    jsx: "react-jsx",
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};

const NEXTJS_ENTRY_TEMPLATE = `// Auto-generated Next.js application
export default function HomePage() {
  return <div>Welcome to {system}</div>;
}
`;

const FASTIFY_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

const FASTIFY_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    jsx: "preserve",
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};

const FASTIFY_ENTRY_TEMPLATE = `// Auto-generated Fastify application
import fastify from 'fastify';

const server = fastify();

server.get('/', async () => {
  return { status: 'ok' };
});

export default server;
`;

const PLAIN_TS_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

const PLAIN_TS_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};

const PLAIN_TS_ENTRY_TEMPLATE = `// Auto-generated plain-TypeScript application entry point
export function main(): void {
  // Application bootstrap for {appName}
}
`;

// Nitro (https://nitro.build). Shape verified end-to-end by the Phase-2 de-risk
// (nitro prepare → tsc → nitro build, all green): the app's tsconfig extends the
// Nitro-generated `./.nitro/types/tsconfig.json` (NOT the workspace base — Nitro
// owns resolution + auto-imports). Those types come from `nitro prepare`, so the
// `typecheck` script runs it first — `tsc` never fails on missing `.nitro/types`
// even if the package manager skips the `prepare` lifecycle for workspace members
// (yarn classic/berry, pnpm, `--ignore-scripts`). `dev`/`build` run prepare
// internally; `prepare` covers IDEs/installs that do honour the lifecycle.
const NITRO_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nitro build",
    "dev": "nitro dev",
    "preview": "node .output/server/index.mjs",
    "prepare": "nitro prepare",
    "lint": "eslint server --ext .ts",
    "typecheck": "nitro prepare && tsc --noEmit"
  },
  "dependencies": {
    "nitropack": "^2.13.0"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

// Standalone, Nitro-managed tsconfig — only `extends`. The generated config
// carries compilerOptions, includes, and the auto-import declarations.
const NITRO_TSCONFIG: TsConfigTemplate = {
  extends: "./.nitro/types/tsconfig.json",
};

const NITRO_CONFIG_TEMPLATE = `import { defineNitroConfig } from "nitropack/config";

// https://nitro.build/config
export default defineNitroConfig({
  srcDir: "server",
  compatibilityDate: "2025-01-01",
});
`;

const NITRO_ROUTE_TEMPLATE = `// Auto-generated Nitro route — GET /
// \`defineEventHandler\` is auto-imported by Nitro (see ./.nitro/types).
export default defineEventHandler(() => ({ status: "ok", app: "{appName}" }));
`;

// Built-in entries are guaranteed to carry the three core pieces; extraFiles is
// optional (only Nitro needs a second root file, nitro.config.ts).
type BuiltinFrameworkTemplate = Required<
  Pick<AppFrameworkConfig, "packageJson" | "tsConfig" | "entryPoint">
> &
  Pick<AppFrameworkConfig, "extraFiles">;

const BUILTIN_FRAMEWORK_TEMPLATES: Partial<
  Record<AppFramework, BuiltinFrameworkTemplate>
> = {
  "next.js": {
    packageJson: { template: NEXTJS_PACKAGE_JSON_TEMPLATE },
    tsConfig: NEXTJS_TSCONFIG,
    entryPoint: {
      path: "src/app/page.tsx",
      template: NEXTJS_ENTRY_TEMPLATE,
    },
  },
  fastify: {
    packageJson: { template: FASTIFY_PACKAGE_JSON_TEMPLATE },
    tsConfig: FASTIFY_TSCONFIG,
    entryPoint: {
      path: "src/index.ts",
      template: FASTIFY_ENTRY_TEMPLATE,
    },
  },
  "plain-ts": {
    packageJson: { template: PLAIN_TS_PACKAGE_JSON_TEMPLATE },
    tsConfig: PLAIN_TS_TSCONFIG,
    entryPoint: {
      path: "src/index.ts",
      template: PLAIN_TS_ENTRY_TEMPLATE,
    },
  },
  nitro: {
    packageJson: { template: NITRO_PACKAGE_JSON_TEMPLATE },
    tsConfig: NITRO_TSCONFIG,
    entryPoint: {
      path: "server/routes/index.ts",
      template: NITRO_ROUTE_TEMPLATE,
    },
    extraFiles: [{ path: "nitro.config.ts", template: NITRO_CONFIG_TEMPLATE }],
  },
};

export { BUILTIN_FRAMEWORK_TEMPLATES };
