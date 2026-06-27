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
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
`;

// Next compiles/bundles itself (`next build`) and type-checks with `noEmit`, so
// this overrides the monorepo base's composite/emit/rootDir defaults rather than
// inheriting them: composite+declaration would trip `next build`, and a
// `rootDir: "src"` excludes Next's generated `.next/types/**` ("not under
// rootDir"). `jsx: "preserve"` hands JSX to Next's compiler. The include covers
// the generated `next-env.d.ts` + `.next/types` (absent until the first build —
// harmless when unmatched) so Next doesn't rewrite the file on build.
const NEXTJS_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: ".",
    composite: false,
    declaration: false,
    emitDeclarationOnly: false,
    noEmit: true,
    jsx: "preserve",
    plugins: [{ name: "next" }],
  },
  include: [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    ".next/types/**/*.ts",
  ],
  // NOT excluding `.next` — `exclude` filters the `include` matches, so listing
  // `.next` here would cancel the `.next/types/**` include above (the generated
  // route types). `include` is already an allowlist, so the rest of `.next/`
  // (cache/server/static) never enters the program regardless.
  exclude: ["node_modules", "dist"],
};

const NEXTJS_ENTRY_TEMPLATE = `// Auto-generated Next.js application
export default function HomePage() {
  return <div>Welcome to {system}</div>;
}
`;

// App Router requires a root layout (`app/layout.tsx`) rendering <html>/<body>,
// or `next build` fails: "page.tsx doesn't have a root layout".
// `{{children}}` is the template-engine escape for a literal `{children}` (a
// bare `{children}` would be read as an interpolation variable); the `{ children }`
// param/type braces carry spaces, so the engine leaves them untouched.
const NEXTJS_LAYOUT_TEMPLATE = `import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{{children}}</body>
    </html>
  );
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
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
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
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
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
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
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
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
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
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
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
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
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

// ---------------------------------------------------------------------------
// Frontend UI frameworks. Each is a Vite-based SPA (Angular uses the Angular
// CLI) — minimal but real starting scaffolds, mirroring the backend set.
// ---------------------------------------------------------------------------

// Vue 3 (Vite). vue-tsc type-checks the SFCs; vite builds.
const VUE_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "vite": "^6.0.0",
    "vue-tsc": "^2.1.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
`;

const VUE_TSCONFIG: TsConfigTemplate = {
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

const VUE_ENTRY_TEMPLATE = `import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
`;

const VUE_APP_TEMPLATE = `<script setup lang="ts"></script>

<template>
  <main>Welcome to {system}</main>
</template>
`;

const VUE_INDEX_HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>{system}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const VUE_VITE_CONFIG_TEMPLATE = `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({ plugins: [vue()] });
`;

// React Router (Vite + React, library/data-router mode).
const REACT_ROUTER_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^6.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
`;

const REACT_ROUTER_TSCONFIG: TsConfigTemplate = {
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

const REACT_ROUTER_ENTRY_TEMPLATE = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";

const router = createBrowserRouter([{ path: "/", element: <App /> }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
`;

const REACT_ROUTER_APP_TEMPLATE = `export default function App() {
  return <main>Welcome to {system}</main>;
}
`;

const REACT_ROUTER_INDEX_HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>{system}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const REACT_ROUTER_VITE_CONFIG_TEMPLATE = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
`;

// Remix (v2, Vite plugin). app/root.tsx is the document shell; routes live in
// app/routes.
const REMIX_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "remix vite:dev",
    "build": "remix vite:build",
    "start": "remix-serve ./build/server/index.js",
    "lint": "eslint app --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@remix-run/node": "^2.15.0",
    "@remix-run/react": "^2.15.0",
    "@remix-run/serve": "^2.15.0",
    "isbot": "^5.1.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@remix-run/dev": "^2.15.0",
    "vite": "^6.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
`;

const REMIX_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: ".",
    outDir: "dist",
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    jsx: "react-jsx",
  },
  include: ["app/**/*"],
  exclude: ["node_modules", "dist", "build"],
};

const REMIX_ROOT_TEMPLATE = `import { Links, Meta, Outlet, Scripts } from "@remix-run/react";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
`;

const REMIX_INDEX_ROUTE_TEMPLATE = `export default function Index() {
  return <main>Welcome to {system}</main>;
}
`;

const REMIX_VITE_CONFIG_TEMPLATE = `import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [remix()] });
`;

// Angular (standalone + application builder). The Angular-specific compiler
// options live in tsconfig.app.json (extraFiles) — the workspace TsConfigTemplate
// can't carry the sibling \`angularCompilerOptions\` key — and angular.json points
// the build there.
const ANGULAR_PACKAGE_JSON_TEMPLATE = `{
  "name": "@{scope}/{appName}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "ng serve",
    "build": "ng build",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.app.json --noEmit"
  },
  "dependencies": {
    "@angular/common": "^19.0.0",
    "@angular/compiler": "^19.0.0",
    "@angular/core": "^19.0.0",
    "@angular/platform-browser": "^19.0.0",
    "rxjs": "^7.8.0",
    "tslib": "^2.7.0",
    "zone.js": "^0.15.0"
  },
  "devDependencies": {
    "@angular/cli": "^19.0.0",
    "@angular/compiler-cli": "^19.0.0",
    "@angular-devkit/build-angular": "^19.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
`;

const ANGULAR_TSCONFIG: TsConfigTemplate = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    // `rootDir: "src"` mirrors every other app template. Without it the app
    // inherits the monorepo base's `rootDir` (the repo root's `src`), and
    // `tsc -p tsconfig.app.json --noEmit` fails with "src/main.ts is not under
    // rootDir". tsconfig.app.json extends this file, so it inherits the override.
    rootDir: "src",
    outDir: "dist",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    lib: ["ES2022", "DOM"],
    skipLibCheck: true,
  },
  // The app build/typecheck uses tsconfig.app.json (it carries Angular's
  // angularCompilerOptions); this base just establishes shared compiler options.
  include: [],
  references: [{ path: "./tsconfig.app.json" }],
};

const ANGULAR_MAIN_TEMPLATE = `// zone.js powers Angular's default (zone-based) change detection — it must be
// imported before bootstrap or async updates won't trigger a re-render.
import "zone.js";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent).catch((err) => console.error(err));
`;

const ANGULAR_COMPONENT_TEMPLATE = `import { Component } from "@angular/core";

@Component({
  selector: "app-root",
  standalone: true,
  template: "<main>Welcome to {system}</main>",
})
export class AppComponent {}
`;

const ANGULAR_INDEX_HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>{system}</title>
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
`;

const ANGULAR_APP_TSCONFIG_TEMPLATE = `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/app",
    "composite": false,
    "declaration": false,
    "types": []
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.ts"],
  "angularCompilerOptions": {
    "strictTemplates": true
  }
}
`;

const ANGULAR_JSON_TEMPLATE = `{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "projects": {
    "{appName}": {
      "projectType": "application",
      "root": "",
      "sourceRoot": "src",
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:application",
          "options": {
            "outputPath": "dist",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json"
          }
        },
        "serve": {
          "builder": "@angular-devkit/build-angular:dev-server",
          "options": { "buildTarget": "{appName}:build" }
        }
      }
    }
  }
}
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
    extraFiles: [
      { path: "src/app/layout.tsx", template: NEXTJS_LAYOUT_TEMPLATE },
    ],
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
  vue: {
    packageJson: { template: VUE_PACKAGE_JSON_TEMPLATE },
    tsConfig: VUE_TSCONFIG,
    entryPoint: { path: "src/main.ts", template: VUE_ENTRY_TEMPLATE },
    extraFiles: [
      { path: "src/App.vue", template: VUE_APP_TEMPLATE },
      { path: "index.html", template: VUE_INDEX_HTML_TEMPLATE },
      { path: "vite.config.ts", template: VUE_VITE_CONFIG_TEMPLATE },
    ],
  },
  "react-router": {
    packageJson: { template: REACT_ROUTER_PACKAGE_JSON_TEMPLATE },
    tsConfig: REACT_ROUTER_TSCONFIG,
    entryPoint: { path: "src/main.tsx", template: REACT_ROUTER_ENTRY_TEMPLATE },
    extraFiles: [
      { path: "src/App.tsx", template: REACT_ROUTER_APP_TEMPLATE },
      { path: "index.html", template: REACT_ROUTER_INDEX_HTML_TEMPLATE },
      { path: "vite.config.ts", template: REACT_ROUTER_VITE_CONFIG_TEMPLATE },
    ],
  },
  remix: {
    packageJson: { template: REMIX_PACKAGE_JSON_TEMPLATE },
    tsConfig: REMIX_TSCONFIG,
    entryPoint: { path: "app/root.tsx", template: REMIX_ROOT_TEMPLATE },
    extraFiles: [
      { path: "app/routes/_index.tsx", template: REMIX_INDEX_ROUTE_TEMPLATE },
      { path: "vite.config.ts", template: REMIX_VITE_CONFIG_TEMPLATE },
    ],
  },
  angular: {
    packageJson: { template: ANGULAR_PACKAGE_JSON_TEMPLATE },
    tsConfig: ANGULAR_TSCONFIG,
    entryPoint: { path: "src/main.ts", template: ANGULAR_MAIN_TEMPLATE },
    extraFiles: [
      {
        path: "src/app/app.component.ts",
        template: ANGULAR_COMPONENT_TEMPLATE,
      },
      { path: "src/index.html", template: ANGULAR_INDEX_HTML_TEMPLATE },
      { path: "tsconfig.app.json", template: ANGULAR_APP_TSCONFIG_TEMPLATE },
      { path: "angular.json", template: ANGULAR_JSON_TEMPLATE },
    ],
  },
};

export { BUILTIN_FRAMEWORK_TEMPLATES };
