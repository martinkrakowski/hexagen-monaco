import fs from "node:fs/promises";
import path from "node:path";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { interpolate } from "../template-engine.js";
import type {
  AppFramework,
  AppFrameworkConfig,
  TsConfigTemplate,
} from "../types/manifest.js";

// =============================================================================
// Types
// =============================================================================

type ReportRecorder = {
  record: (type: string, target: string, message: string) => void;
};

type WriteStatus = Awaited<ReturnType<typeof safeWriteFileAtomic>>;

// =============================================================================
// Built-in framework fallbacks
// =============================================================================
//
// Mined from the current `createAppFiles` method in
// `packages/project-generation/src/infrastructure/adapters/external-sync-engine.adapter.ts`
// and `generateAppStubContent` in the sibling `root-files.ts`.
//
// These fallbacks are used ONLY when the manifest does not declare a template
// for the given framework under `generator.sync.apps.frameworks[<framework>]`.
// They preserve the adapter's historical behaviour so migration from the
// adapter-side scaffolding to the unified generator is a no-op for consumers
// that have not yet populated their manifest.
//
// Interpolation variables available in every template:
//   - {appName}    — the app's `name` field
//   - {system}     — `manifest.system`
//   - {version}    — the app's `version` field (if set)
//   - {depends_on} — the app's `depends_on` array joined with ", "

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

/**
 * Built-in framework fallbacks keyed by {@link AppFramework}.
 *
 * Each entry is a fully populated {@link AppFrameworkConfig}: a package.json
 * template (string), a structured tsconfig template ({@link TsConfigTemplate}),
 * and an entry-point with both `path` and `template`.
 *
 * The `express` framework is intentionally omitted — the legacy adapter never
 * supported it and no migration path exists yet. If a manifest declares an
 * Express app with no template, the generator logs an error and skips it
 * rather than falling through to a wrong framework's template.
 */
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Merge a manifest-declared framework config on top of the built-in fallback
 * (if one exists). Any field absent from the manifest falls through to the
 * built-in. Returns `undefined` when neither source supplies a config — the
 * caller treats this as "unknown framework, skip the app".
 */
function resolveFrameworkConfig(
  framework: AppFramework,
  manifestConfig: AppFrameworkConfig | undefined,
): AppFrameworkConfig | undefined {
  const builtin = BUILTIN_FRAMEWORK_TEMPLATES[framework];
  if (!manifestConfig && !builtin) return undefined;
  if (!manifestConfig) return builtin;
  if (!builtin) return manifestConfig;
  return {
    packageJson: manifestConfig.packageJson ?? builtin.packageJson,
    tsConfig: manifestConfig.tsConfig ?? builtin.tsConfig,
    entryPoint: manifestConfig.entryPoint ?? builtin.entryPoint,
  };
}

/**
 * Interpolate a template string with the app-scoped variable bag. Warnings
 * collected by the template engine are forwarded to `config.logger.warn` so
 * author mistakes (typo'd placeholders, missing manifest fields) surface in
 * the sync log without failing the generation.
 */
function interpolateWithLogging(
  template: string,
  vars: Record<string, unknown>,
  context: string,
  config: SyncConfig,
): string {
  const { output, warnings } = interpolate(template, vars);
  if (warnings.length > 0) {
    // Dedupe for a cleaner log; the engine already records each occurrence.
    const unique = Array.from(new Set(warnings));
    config.logger.warn(
      `[apps] unresolved template placeholder(s) in ${context}: ${unique
        .map((w) => `{${w}}`)
        .join(", ")}`,
    );
  }
  return output;
}

/**
 * Map a {@link WriteStatus} onto the {@link GeneratorResult} accumulator.
 * Centralised so every write path records identically.
 */
function recordStatus(
  result: GeneratorResult,
  filePath: string,
  status: WriteStatus,
): void {
  if (status === "created") {
    result.created.push(filePath);
    result.totalOps += 1;
  } else if (status === "updated") {
    result.updated.push(filePath);
    result.totalOps += 1;
  } else {
    // "skipped" | "protected" | "unchanged" — all no-op from the caller's
    // perspective; we surface them via the skipped list for visibility.
    result.skipped.push(filePath);
  }
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Generate the per-app scaffolding under `${workspaceRoot}/apps/<name>/` for
 * every entry in `config.manifest.apps`.
 *
 * For each app the generator emits three files:
 *
 *   1. `package.json`         — from `frameworkConfig.packageJson.template`
 *   2. `tsconfig.json`        — from the structured `frameworkConfig.tsConfig`
 *      (serialised via `JSON.stringify(ts, null, 2)` — no template interpolation)
 *   3. `<entryPoint.path>`    — from `frameworkConfig.entryPoint.template`
 *      (commonly `src/app/page.tsx` for Next.js, `src/index.ts` otherwise)
 *
 * Template sourcing follows a two-level cascade (per
 * `sync-engine-unified-scaffolding` plan §Phase 3):
 *
 *   1. `config.manifest.generator?.sync?.apps?.frameworks?.[app.framework]`
 *   2. Built-in fallback for that framework (next.js / fastify / plain-ts)
 *
 * If the manifest declares *some* fields for a framework, any field it does
 * not declare falls through to the built-in fallback of the same framework.
 *
 * Variables interpolated into string templates:
 *   - `{appName}`    — `app.name`
 *   - `{system}`     — `manifest.system` (falls back to the empty string)
 *   - `{version}`    — `app.version` (falls back to the empty string)
 *   - `{depends_on}` — `app.depends_on` joined with `", "` (empty array → `""`)
 *
 * Behaviour rules:
 *   - **Dedup:** when two entries in `apps[]` share the same `name`, the first
 *     occurrence wins. Subsequent duplicates are logged via `logger.warn` and
 *     skipped entirely (matching the current adapter's set-based behaviour,
 *     which also produces one directory per name).
 *   - **Unknown framework:** when an app declares a framework with no manifest
 *     template *and* no built-in fallback (e.g. `express`), the error is logged
 *     and the app is skipped — the rest of the sync continues.
 *   - **Missing `app.framework`:** same treatment as unknown framework.
 *   - **Missing `manifest.apps`:** returns an empty result; no writes occur.
 *   - **Existing hand-written files:** preserved via `safeWriteFileAtomic`
 *     (any pre-existing non-`@generated` file is reported as `skipped`). This
 *     guarantees hexagen-monaco's hand-written `apps/web/*` and
 *     `apps/api-gateway/*` are never touched during self-regen.
 *
 * @param config - The full sync configuration (manifest + flags + logger)
 * @param report - Optional migration-report recorder forwarded to
 *                 `safeWriteFileAtomic` for structured change tracking
 * @returns A {@link GeneratorResult} summarising created / updated / skipped
 *          files. On an uncaught error the result's `error` field is set and
 *          the function returns normally — it never throws.
 */
export async function generateApps(
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  try {
    const apps = config.manifest.apps;
    if (!apps || apps.length === 0) {
      // Nothing declared → no writes, no error. Matches plan §Phase 3
      // "Missing manifest.apps → empty result".
      return result;
    }

    const appsGenConfig = config.manifest.generator?.sync?.apps;
    const system = (config.manifest.system as string | undefined) ?? "";

    const seen = new Set<string>();

    for (const app of apps) {
      if (!app || typeof app.name !== "string" || app.name.length === 0) {
        config.logger.warn(`[apps] skipping entry with missing or empty name`);
        continue;
      }

      // First-wins dedup. Chosen to match the current adapter's effective
      // behaviour (`appTypes` is a Set, so duplicate names collapse into a
      // single directory whose content is driven by the first hit).
      if (seen.has(app.name)) {
        config.logger.warn(
          `[apps] duplicate app name "${app.name}" — keeping first occurrence, skipping this duplicate`,
        );
        continue;
      }
      seen.add(app.name);

      const framework = app.framework;
      if (!framework) {
        config.logger.error(
          `[apps] app "${app.name}" has no framework declared — skipping`,
        );
        if (report) {
          report.record(
            "blocked",
            app.name,
            "App missing `framework` field; cannot resolve template",
          );
        }
        continue;
      }

      const manifestFrameworkConfig = appsGenConfig?.frameworks?.[framework];
      const frameworkConfig = resolveFrameworkConfig(
        framework,
        manifestFrameworkConfig,
      );
      if (!frameworkConfig) {
        config.logger.error(
          `[apps] unknown framework "${framework}" for app "${app.name}" — no manifest template and no built-in fallback; skipping`,
        );
        if (report) {
          report.record("blocked", app.name, `Unknown framework: ${framework}`);
        }
        continue;
      }

      const vars: Record<string, unknown> = {
        appName: app.name,
        system,
        version: app.version ?? "",
        depends_on: (app.depends_on ?? []).join(", "),
      };

      const appDir = path.join(config.workspaceRoot, "apps", app.name);
      const srcDir = path.join(appDir, "src");

      try {
        await fs.mkdir(appDir, { recursive: true });
        await fs.mkdir(srcDir, { recursive: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        config.logger.error(
          `[apps] failed to create directory for "${app.name}": ${message}`,
        );
        if (report) report.record("blocked", app.name, message);
        continue;
      }

      // ---- package.json ----------------------------------------------------
      const pkgTemplate = frameworkConfig.packageJson?.template;
      if (pkgTemplate) {
        const pkgContent = interpolateWithLogging(
          pkgTemplate,
          vars,
          `apps/${app.name}/package.json`,
          config,
        );
        const pkgPath = path.join(appDir, "package.json");
        const status = await safeWriteFileAtomic(
          pkgPath,
          pkgContent,
          config,
          report,
        );
        recordStatus(result, pkgPath, status);
      } else {
        config.logger.warn(
          `[apps] framework "${framework}" has no package.json template — skipping package.json for "${app.name}"`,
        );
      }

      // ---- tsconfig.json ---------------------------------------------------
      const tsConfig = frameworkConfig.tsConfig;
      if (tsConfig) {
        const tsContent = JSON.stringify(tsConfig, null, 2) + "\n";
        const tsPath = path.join(appDir, "tsconfig.json");
        const status = await safeWriteFileAtomic(
          tsPath,
          tsContent,
          config,
          report,
        );
        recordStatus(result, tsPath, status);
      } else {
        config.logger.warn(
          `[apps] framework "${framework}" has no tsConfig — skipping tsconfig.json for "${app.name}"`,
        );
      }

      // ---- entry point -----------------------------------------------------
      const entry = frameworkConfig.entryPoint;
      if (entry?.path && entry.template !== undefined) {
        const entryContent = interpolateWithLogging(
          entry.template,
          vars,
          `apps/${app.name}/${entry.path}`,
          config,
        );
        const entryPath = path.join(appDir, entry.path);
        try {
          await fs.mkdir(path.dirname(entryPath), { recursive: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          config.logger.error(
            `[apps] failed to create entry-point dir for "${app.name}": ${message}`,
          );
          if (report) report.record("blocked", app.name, message);
          continue;
        }
        const status = await safeWriteFileAtomic(
          entryPath,
          entryContent,
          config,
          report,
        );
        recordStatus(result, entryPath, status);
      } else {
        config.logger.warn(
          `[apps] framework "${framework}" has no entryPoint template — skipping entry file for "${app.name}"`,
        );
      }
    }

    result.summary = `apps: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} skipped`;
    return result;
  } catch (err) {
    // Per AGENTS.md §9 "Silent Error Swallowing (Hard Rejection)": surface
    // the error in the structured result instead of throwing. Callers inspect
    // `result.error` to decide whether to abort the sync.
    const message = err instanceof Error ? err.message : String(err);
    result.error =
      err instanceof Error
        ? err
        : new Error(`apps generation failed: ${message}`);
    result.summary = `apps generation failed: ${message}`;
    return result;
  }
}
