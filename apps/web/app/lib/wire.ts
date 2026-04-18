// apps/web/app/lib/wire.ts
// Centralized dependency composition root for web driver
// All cross-package imports go through root barrels only (lint-enforced)
/* eslint-disable no-console */
// Console is intentional here: this file implements LoggerPort and emits
// startup diagnostics. All other application code must use LoggerPort instead.

// Emit build info once on client bootstrap — intentional per eslint-disable above
if (typeof window !== "undefined") {
  console.info(
    `%c HexaGen v${process.env.APP_VERSION ?? "local"} · ${process.env.COMMIT_HASH ?? "dev"} `,
    "background: #1e1e2e; color: #a6e3a1; border-radius: 3px; padding: 2px 6px; font-family: monospace;",
  );
}

import type {
  CanvasLayoutPersistencePort,
  EditorWorkspacePersistencePort,
  MonacoPersistencePort,
  WizardPersistencePort,
} from "@hexagen/shared";
import type { DownloadProjectPort } from "@hexagen/web-driver";
import type { LoggerPort } from "@hexagen/shared";
import type { IArchitectureGraphProviderPort } from "@hexagen/visualization";
import type { EventBusPort, IntentBusPort } from "@hexagen/messaging";
import type { LLMProviderPort } from "@hexagen/agentic-interaction";
import type {
  LocalLLMProviderPort,
  WebGPUDetectorPort,
  HardwareProfilerPort,
} from "@hexagen/local-llm";
import {
  LocalStoragePersistenceAdapter,
  LocalStorageCanvasLayoutAdapter,
  ArchitectureGraphProviderAdapter,
} from "@hexagen/web-driver";
import {
  InMemoryEventBusAdapter,
  InMemoryIntentBusAdapter,
} from "@hexagen/messaging";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";
import {
  WebLLMAdapter,
  WebGPUCapabilityAdapter,
  BrowserHardwareProfilerAdapter,
} from "@hexagen/local-llm";

const createWebLogger = (): LoggerPort => ({
  info: (msg) => console.log(`[web] ${msg}`),
  warn: (msg) => console.warn(`[web] ${msg}`),
  error: (msg) => console.error(`[web] ${msg}`),
  debug: (msg) => {
    if (process.env.DEBUG) console.log(`[debug] ${msg}`);
  },
  errorWithException: (err, msg) => {
    const errorMessage =
      msg ?? (err instanceof Error ? err.message : String(err));
    console.error(`[web] ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  },
});

const createEventBus = (): EventBusPort => new InMemoryEventBusAdapter();

const createIntentBus = (): IntentBusPort => new InMemoryIntentBusAdapter();

const createLLMProvider = (): LLMProviderPort => {
  const apiKey = process.env.NEXT_PUBLIC_LLM_API_KEY || "";
  const baseUrl =
    process.env.NEXT_PUBLIC_LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    console.warn(
      "[LLMProviderPort] No API key configured - LLM features will be disabled",
    );
  }

  return new ServerLLMAdapter(apiKey, baseUrl, model);
};

/**
 * Simple registry-based composition for ports used by web-driver use-cases.
 * Intent Bus / projections / components consume via typed getters.
 */
export const wireDependencies = () => {
  const registry = new Map<string, unknown>();

  // Monaco persistence port → concrete localStorage adapter
  const localStorageAdapter = new LocalStoragePersistenceAdapter();
  registry.set(
    "MonacoPersistencePort",
    localStorageAdapter satisfies MonacoPersistencePort,
  );

  // Wizard persistence port → same localStorage adapter
  registry.set(
    "WizardPersistencePort",
    localStorageAdapter satisfies WizardPersistencePort,
  );

  // Editor workspace persistence port → same localStorage adapter
  registry.set(
    "EditorWorkspacePersistencePort",
    localStorageAdapter satisfies EditorWorkspacePersistencePort,
  );

  // Canvas layout persistence port → dedicated adapter
  const canvasLayoutAdapter = new LocalStorageCanvasLayoutAdapter();
  registry.set(
    "CanvasLayoutPersistencePort",
    canvasLayoutAdapter satisfies CanvasLayoutPersistencePort,
  );

  // Logger port → console logger for web app
  registry.set("LoggerPort", createWebLogger() satisfies LoggerPort);

  // Download project port → not yet implemented; returns structured failure
  registry.set("DownloadProjectPort", {
    downloadProject: async () => {
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

  // Event Bus → in-memory implementation
  registry.set("EventBusPort", createEventBus() satisfies EventBusPort);

  // Intent Bus → in-memory implementation
  registry.set("IntentBusPort", createIntentBus() satisfies IntentBusPort);

  // LLM Provider → server adapter with env config
  registry.set(
    "LLMProviderPort",
    createLLMProvider() satisfies LLMProviderPort,
  );

  // Local LLM Provider → WebLLM browser adapter (singleton, lazily initialized)
  // Worker is bundled by webpack 5 via new URL() static analysis — no CDN required.
  const localLLMAdapter = new WebLLMAdapter({
    createWorker: () =>
      new Worker(new URL("../workers/webllm.worker.ts", import.meta.url), {
        type: "module",
      }),
  });
  registry.set(
    "LocalLLMProviderPort",
    localLLMAdapter satisfies LocalLLMProviderPort,
  );

  // WebGPU Detector → browser capability adapter
  registry.set(
    "WebGPUDetectorPort",
    new WebGPUCapabilityAdapter() satisfies WebGPUDetectorPort,
  );

  // Hardware Profiler → browser hardware detection adapter
  registry.set(
    "HardwareProfilerPort",
    new BrowserHardwareProfilerAdapter() satisfies HardwareProfilerPort,
  );

  return {
    get: <T>(portName: string): T => {
      const instance = registry.get(portName);
      if (!instance) {
        throw new Error(`No implementation registered for port: ${portName}`);
      }
      return instance as T;
    },
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

export const getEventBus = () => dependencies.get<EventBusPort>("EventBusPort");

export const getIntentBus = () =>
  dependencies.get<IntentBusPort>("IntentBusPort");

export const getLLMProvider = () =>
  dependencies.get<LLMProviderPort>("LLMProviderPort");

export const getWizardPersistence = () =>
  dependencies.get<WizardPersistencePort>("WizardPersistencePort");

export const getEditorWorkspacePersistence = () =>
  dependencies.get<EditorWorkspacePersistencePort>(
    "EditorWorkspacePersistencePort",
  );

export const getCanvasLayoutPersistence = () =>
  dependencies.get<CanvasLayoutPersistencePort>("CanvasLayoutPersistencePort");

export const getLocalLLMProvider = () =>
  dependencies.get<LocalLLMProviderPort>("LocalLLMProviderPort");

export const getWebGPUDetector = () =>
  dependencies.get<WebGPUDetectorPort>("WebGPUDetectorPort");

export const getHardwareProfiler = () =>
  dependencies.get<HardwareProfilerPort>("HardwareProfilerPort");
