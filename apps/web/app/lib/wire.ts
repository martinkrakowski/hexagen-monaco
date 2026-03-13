// apps/web/app/lib/wire.ts
// Centralized dependency composition root for web driver
// All cross-package imports go through root barrels only (lint-enforced)

import type { MonacoPersistencePort } from "@hexagen/monaco-orchestration";
import type { DownloadProjectPort, Project } from "@hexagen/web-driver";
import { LocalStoragePersistenceAdapter } from "@hexagen/web-driver";

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
