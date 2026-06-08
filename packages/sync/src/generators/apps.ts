import fs from "node:fs/promises";
import path from "node:path";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { interpolate } from "../template-engine.js";
import {
  resolveScope,
  type AppFramework,
  type AppFrameworkConfig,
} from "../types/manifest.js";
import { BUILTIN_FRAMEWORK_TEMPLATES } from "./apps-framework-templates.js";
import { generateEslintConfig } from "./eslint.js";
import type { ReportRecorder } from "../domain/types.js";

type WriteStatus = Awaited<ReturnType<typeof safeWriteFileAtomic>>;

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
    extraFiles: manifestConfig.extraFiles ?? builtin.extraFiles,
  };
}

function interpolateWithLogging(
  template: string,
  vars: Record<string, unknown>,
  context: string,
  config: SyncConfig,
): string {
  const { output, warnings } = interpolate(template, vars);
  if (warnings.length > 0) {
    const unique = Array.from(new Set(warnings));
    config.logger.warn(
      `[apps] unresolved template placeholder(s) in ${context}: ${unique
        .map((w) => `{${w}}`)
        .join(", ")}`,
    );
  }
  return output;
}

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
    result.skipped.push(filePath);
  }
}

/**
 * Fold a sub-generator's result (e.g. the shared eslint emitter) into the apps
 * result: concatenate the path buckets, sum totalOps, and surface the first
 * error so a failed eslint write isn't silently dropped.
 */
function mergeResult(result: GeneratorResult, sub: GeneratorResult): void {
  result.created.push(...sub.created);
  result.updated.push(...sub.updated);
  result.skipped.push(...sub.skipped);
  result.totalOps += sub.totalOps;
  if (sub.error && !result.error) {
    result.error = sub.error;
    result.summary = sub.summary;
  }
}

/**
 * Interpolate a template and write it to `relPath` under `appDir`, with the same
 * path containment as the entry point. `relPath` is manifest-overridable (via
 * `generator.sync.apps.frameworks.<fw>.{entryPoint,extraFiles}`), so it must
 * resolve to a location inside `apps/<name>/`. Resolve against `appDir` with
 * `path.resolve` (not `path.join` — `resolve` treats an absolute `relPath` as a
 * new root, so absolute paths are rejected here rather than silently nested) and
 * reject anything that escapes: a ".." segment, the appDir itself, an absolute
 * path, or (on Windows) a different drive/UNC root.
 */
async function emitAppFile(
  appDir: string,
  relPath: string,
  template: string,
  vars: Record<string, unknown>,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  result: GeneratorResult,
  appName: string,
): Promise<"ok" | "unsafe" | "error"> {
  const content = interpolateWithLogging(
    template,
    vars,
    `apps/${appName}/${relPath}`,
    config,
  );
  const target = path.resolve(appDir, relPath);
  const relative = path.relative(appDir, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    config.logger.warn(
      `[apps] skipping file with unsafe path (escapes apps/${appName}): ${relPath}`,
    );
    if (report) {
      report.record(
        "blocked",
        appName,
        `Unsafe file path (potential path traversal): ${relPath}`,
      );
    }
    return "unsafe";
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    config.logger.error(
      `[apps] failed to create dir for "${appName}" file ${relPath}: ${message}`,
    );
    if (report) report.record("blocked", appName, message);
    return "error";
  }
  recordStatus(
    result,
    target,
    await safeWriteFileAtomic(target, content, config, report),
  );
  return "ok";
}

export async function generateApps(
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  try {
    const appsGenConfig = config.manifest.generator?.sync?.apps;

    if (appsGenConfig?.enabled !== true) {
      return result;
    }

    const apps = config.manifest.apps;
    if (!apps || apps.length === 0) {
      return result;
    }

    const system = (config.manifest.system as string | undefined) ?? "";
    // App packages use the project's npm scope (@{scope}/<app>), not @{system}.
    const scope = resolveScope(config.manifest);

    const seen = new Set<string>();

    for (const app of apps) {
      if (!app || typeof app.name !== "string" || app.name.length === 0) {
        config.logger.warn(`[apps] skipping entry with missing or empty name`);
        continue;
      }

      // Path safety: app.name becomes a directory under apps/ via path.join
      // below, so a name containing a path separator or a ".." segment could
      // escape apps/ (or the workspace root entirely). Mirror the module-name
      // guard in SyncEngine and skip such entries. Defense-in-depth: this
      // protects every manifest source — a hand-written or API-supplied manifest
      // may carry an unsafe name that never went through the wizard's slugified
      // app-name derivation.
      if (
        app.name.includes("..") ||
        app.name.includes("/") ||
        app.name.includes("\\") ||
        app.name.startsWith(".")
      ) {
        config.logger.warn(
          `[apps] skipping app with unsafe name (potential path traversal): ${app.name}`,
        );
        if (report) {
          report.record(
            "blocked",
            app.name,
            "Unsafe app name (potential path traversal)",
          );
        }
        continue;
      }

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
        scope,
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

      const entry = frameworkConfig.entryPoint;
      if (entry?.path && entry.template !== undefined) {
        const status = await emitAppFile(
          appDir,
          entry.path,
          entry.template,
          vars,
          config,
          report,
          result,
          app.name,
        );
        // An unsafe/failed entry path skips the rest of this app (prior behavior).
        if (status !== "ok") continue;
      } else {
        config.logger.warn(
          `[apps] framework "${framework}" has no entryPoint template — skipping entry file for "${app.name}"`,
        );
      }

      // Additional root files beyond the single entry point (e.g. Nitro's
      // nitro.config.ts). An unsafe/failed extra file is logged inside emitAppFile
      // and skipped individually — it does not abort the whole app.
      for (const extra of frameworkConfig.extraFiles ?? []) {
        if (!extra?.path || extra.template === undefined) continue;
        await emitAppFile(
          appDir,
          extra.path,
          extra.template,
          vars,
          config,
          report,
          result,
          app.name,
        );
      }

      // Every app declares a `lint` script + eslint devDeps but shipped no
      // eslint.config.js — ESLint 9's flat config is mandatory, so `yarn lint`
      // aborted with "couldn't find an eslint.config file" and CI failed.
      // Reuse the package generator's eslint emitter (same flat-config cascade +
      // `@generated` marker, so a hand-authored app config is still protected on
      // self-regen). The config's `ignores` cover dist/node_modules; each app's
      // `lint` script scopes the path (src/ or Nitro's server/).
      // usePerContextOverride:false — an app name must never inherit a
      // bounded-context eslint override (different namespace; collisions would
      // apply a package-intended template to the app). Workspace default +
      // fallback only.
      const eslintResult = await generateEslintConfig(
        appDir,
        app.name,
        config,
        report,
        { usePerContextOverride: false },
      );
      mergeResult(result, eslintResult);
    }

    // Preserve a sub-generator's error summary (set by mergeResult) instead of
    // clobbering it with the success line — result.error is set in that case.
    if (!result.error) {
      result.summary = `apps: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} skipped`;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error =
      err instanceof Error
        ? err
        : new Error(`apps generation failed: ${message}`);
    result.summary = `apps generation failed: ${message}`;
    return result;
  }
}
