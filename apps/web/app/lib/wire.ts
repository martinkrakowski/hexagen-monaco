// apps/web/app/lib/wire.ts
// Centralized dependency composition root for web driver
// All cross-package imports go through root barrels only (lint-enforced)

import type { MonacoPersistencePort } from '@hexagen/monaco-orchestration';
import type { DownloadProjectPort } from '@hexagen/web-driver';
import { LocalStoragePersistenceAdapter } from '@hexagen/web-driver'; // same context → allowed

// Note: LocalStoragePersistenceAdapter is allowed direct import because it is in the same bounded context (web-driver).
// All external ports must come from root barrels.

/**
 * Simple registry-based composition for ports used by web-driver use-cases.
 * Intent Bus / projections / components consume via typed getters.
 */
export const wireDependencies = () => {
  const registry = new Map<string, unknown>();

  // Monaco persistence port → concrete localStorage adapter
  registry.set(
    'MonacoPersistencePort',
    new LocalStoragePersistenceAdapter() satisfies MonacoPersistencePort
  );

  // Download project port → placeholder (to be replaced with jszip / zip adapter later)
  registry.set('DownloadProjectPort', {
    downloadProject: async (_projectId: string) => {
      console.warn('[DownloadProjectPort] Not implemented yet', _projectId);
      return { success: false, error: { kind: 'NotImplemented' } };
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
  dependencies.get<MonacoPersistencePort>('MonacoPersistencePort');

export const getDownloadProject = () =>
  dependencies.get<DownloadProjectPort>('DownloadProjectPort');
