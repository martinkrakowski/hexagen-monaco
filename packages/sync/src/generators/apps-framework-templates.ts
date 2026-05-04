import type {
  AppFramework,
  AppFrameworkConfig,
  TsConfigTemplate,
} from "../types/manifest.js";

const NEXTJS_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{system}/{appName}",
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
  "name": "@{system}/{appName}",
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
  "name": "@{system}/{appName}",
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

const BUILTIN_FRAMEWORK_TEMPLATES: Partial<
  Record<AppFramework, Required<AppFrameworkConfig>>
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
};

export { BUILTIN_FRAMEWORK_TEMPLATES };
