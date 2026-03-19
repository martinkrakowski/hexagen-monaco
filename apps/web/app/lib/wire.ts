// apps/web/app/lib/wire.ts
// Centralized dependency composition root for web driver
// All cross-package imports go through root barrels only (lint-enforced)

import type { MonacoPersistencePort } from "@hexagen/monaco-orchestration";
import type { DownloadProjectPort, Project } from "@hexagen/web-driver";
import type { LoggerPort } from "@hexagen/shared";
import type { IArchitectureGraphProviderPort } from "@hexagen/visualization";
import {
  LocalStoragePersistenceAdapter,
  ArchitectureGraphProviderAdapter,
} from "@hexagen/web-driver";

// Note: LocalStoragePersistenceAdapter and ArchitectureGraphProviderAdapter are imported through barrel exports.
// Direct adapter imports bypass package boundary integrity; all adapters must be re-exported at @hexagen/web-driver root.

const createWebLogger = (): LoggerPort => ({
  // eslint-disable-next-line no-console
  info: (msg) => console.log(`[web] ${msg}`),
  // eslint-disable-next-line no-console
  warn: (msg) => console.warn(`[web] ${msg}`),
  // eslint-disable-next-line no-console
  error: (msg) => console.error(`[web] ${msg}`),
  debug: (msg) => {
    // turbo lint rule for env var - DEBUG is a common dev flag
    // eslint-disable-next-line turbo/no-undeclared-env-vars, no-console
    if (process.env.DEBUG) console.log(`[debug] ${msg}`);
  },
  errorWithException: (err, msg) => {
    const errorMessage =
      msg ?? (err instanceof Error ? err.message : String(err));
    // eslint-disable-next-line no-console
    console.error(`[web] ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      // eslint-disable-next-line no-console
      console.error(err.stack);
    }
  },
});

// Note: LocalStoragePersistenceAdapter is allowed direct import because it is in the same bounded context (web-driver).
// All external ports must come from root barrels.
// Note: Project generation imports are in separate file (wire.project-generation.ts)
// to avoid Node.js dependencies being bundled into client components.

/**
 * Simple registry-based composition for ports used by web-driver use-cases.
 * Intent Bus / projections / components consume via typed getters.
 */
export const wireDependencies = () => {
  const registry = new Map<string, unknown>();

  // Monaco persistence port → concrete localStorage adapter
  registry.set(
    "MonacoPersistencePort",
    new LocalStoragePersistenceAdapter() satisfies MonacoPersistencePort,
  );

  // Logger port → console logger for web app
  registry.set("LoggerPort", createWebLogger() satisfies LoggerPort);

  // Download project port → placeholder (to be replaced with jszip / zip adapter later)
  registry.set("DownloadProjectPort", {
    downloadProject: async (_project: Project) => {
      // eslint-disable-next-line no-console
      console.warn("[DownloadProjectPort] Not implemented yet", _project);
      return {
        success: false as const,
        error: {
          code: "DOWNLOAD_FAILED" as const,
          message: "Not implemented",
        },
      };
    },
  } satisfies DownloadProjectPort);

  // Architecture graph provider port → concrete adapter instance
  registry.set(
    "ArchitectureGraphProviderPort",
    new ArchitectureGraphProviderAdapter() satisfies IArchitectureGraphProviderPort,
  );

  // Future ports/adapters go here

  return {
    get: <T>(portName: string): T => {
      const instance = registry.get(portName);
      if (!instance) {
        throw new Error(`No implementation registered for port: ${portName}`);
      }
      return instance as T;
    },
    // For tests/mocking
    register: (portName: string, instance: unknown) => {
      registry.set(portName, instance);
    },
  };
};

// Singleton instance (app-wide)
export const dependencies = wireDependencies();

// Typed convenience getters
export const getMonacoPersistence = () =>
  dependencies.get<MonacoPersistencePort>("MonacoPersistencePort");

export const getDownloadProject = () =>
  dependencies.get<DownloadProjectPort>("DownloadProjectPort");

export const getArchitectureGraphProvider = () =>
  dependencies.get<IArchitectureGraphProviderPort>(
    "ArchitectureGraphProviderPort",
  );

export const getLogger = () => dependencies.get<LoggerPort>("LoggerPort");
