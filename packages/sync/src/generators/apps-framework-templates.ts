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

// No empty `"dependencies": {}` block (PR-B2 review): yarn 4 strips one from
// workspace manifests during install, and the emitter doctrine since the
// package-json churn fix is to emit yarn's normalized form. App package.jsons
// are create-once-then-preserved (JSON can't carry the @generated marker), so
// the old block couldn't churn — but it diverged from this template on the
// consumer's first install.
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

// Standalone, Nitro-managed tsconfig: extends the Nitro-generated config (which
// carries `include` + the auto-import declarations) and pins `moduleResolution:
// "bundler"` explicitly. Nitro's generated config already uses Bundler, but
// pinning it keeps the generated app compliant with the repo's bundler-resolution
// standard without relying on a file that only exists after `nitro prepare`
// (qodo rule 798530). Re-verified: `nitro prepare` + `tsc` still pass with the
// override merged onto the inherited config.
// Extends Nitro's generated config (Nitro owns module resolution + auto-import
// types) but re-asserts `strict` + `skipLibCheck`: the .nitro base is NOT strict,
// so without this the API app loses strict checking and `Result<T,E>`
// discriminated-union narrowing silently stops working. Do NOT switch `extends`
// back to the workspace base — that drops the .nitro/types auto-import decls.
const NITRO_TSCONFIG: TsConfigTemplate = {
  extends: "./.nitro/types/tsconfig.json",
  compilerOptions: {
    moduleResolution: "bundler",
    strict: true,
    skipLibCheck: true,
  },
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

// Express (https://expressjs.com). Shares the workspace-base tsconfig shape with
// fastify/plain-ts; the typed handler keeps strict mode happy.
const EXPRESS_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^5.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

const EXPRESS_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    // Emit runnable JS (declaration alongside) — the app's `build: tsc` must
    // produce dist/*.js to run; NOT declaration-only.
    composite: true,
    declaration: true,
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};

const EXPRESS_ENTRY_TEMPLATE = `// Auto-generated Express application
import express from "express";

const app = express();

app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "{appName}" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port);

export default app;
`;

// NestJS (https://nestjs.com). Needs decorator metadata; emits a module +
// controller + the nest-cli.json the \`nest\` CLI reads (via extraFiles).
const NESTJS_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

const NESTJS_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    // Emit runnable JS (not declaration-only): `nest build` falls back to this
    // tsconfig when there's no tsconfig.build.json, so it must produce dist/*.js.
    composite: true,
    declaration: true,
    // NestJS relies on decorator metadata for dependency injection.
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};

const NESTJS_ENTRY_TEMPLATE = `// Auto-generated NestJS application entry point
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
`;

const NESTJS_MODULE_TEMPLATE = `import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";

@Module({
  controllers: [AppController],
})
export class AppModule {}
`;

const NESTJS_CONTROLLER_TEMPLATE = `import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  getStatus(): { status: string; app: string } {
    return { status: "ok", app: "{appName}" };
  }
}
`;

const NESTJS_CLI_TEMPLATE = `{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
`;

// Serverless: an AWS Lambda handler deployed with the Serverless Framework v4
// (the most common "serverless" backend). Runtime deps are provided by Lambda,
// so only dev tooling is declared; serverless.yml ships via extraFiles.
const SERVERLESS_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "deploy": "tsc && serverless deploy",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.0",
    "serverless": "^4.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
`;

const SERVERLESS_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    // Emit runnable JS to dist/ — the Lambda handler must exist as JS for deploy
    // (serverless.yml points at dist/handler.handler).
    composite: true,
    declaration: true,
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};

const SERVERLESS_ENTRY_TEMPLATE = `// Auto-generated AWS Lambda handler (Serverless Framework)
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

export const handler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 200,
    body: JSON.stringify({ status: "ok", app: "{appName}" }),
  };
};
`;

const SERVERLESS_CONFIG_TEMPLATE = `service: {appName}
frameworkVersion: "4"

provider:
  name: aws
  runtime: nodejs20.x

functions:
  api:
    handler: dist/handler.handler
    events:
      - httpApi:
          path: /
          method: get
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
  express: {
    packageJson: { template: EXPRESS_PACKAGE_JSON_TEMPLATE },
    tsConfig: EXPRESS_TSCONFIG,
    entryPoint: { path: "src/index.ts", template: EXPRESS_ENTRY_TEMPLATE },
  },
  nestjs: {
    packageJson: { template: NESTJS_PACKAGE_JSON_TEMPLATE },
    tsConfig: NESTJS_TSCONFIG,
    entryPoint: { path: "src/main.ts", template: NESTJS_ENTRY_TEMPLATE },
    extraFiles: [
      { path: "src/app.module.ts", template: NESTJS_MODULE_TEMPLATE },
      { path: "src/app.controller.ts", template: NESTJS_CONTROLLER_TEMPLATE },
      { path: "nest-cli.json", template: NESTJS_CLI_TEMPLATE },
    ],
  },
  serverless: {
    packageJson: { template: SERVERLESS_PACKAGE_JSON_TEMPLATE },
    tsConfig: SERVERLESS_TSCONFIG,
    entryPoint: { path: "src/handler.ts", template: SERVERLESS_ENTRY_TEMPLATE },
    extraFiles: [
      { path: "serverless.yml", template: SERVERLESS_CONFIG_TEMPLATE },
    ],
  },
};

export { BUILTIN_FRAMEWORK_TEMPLATES };
