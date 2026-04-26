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

import type { LoggerPort } from "@hexagen/shared";
import type {
  IArchitectureGraphProviderPort,
  GenerateHexagonalMapPort,
} from "@hexagen/visualization";
import { HexagonalMapGeneratorAdapter } from "@hexagen/visualization";
import type { EventBusPort, IntentBusPort } from "@hexagen/messaging";
import type {
  LLMProviderPort,
  SecretVaultPort,
  ServerLLMRequestPort,
} from "@hexagen/agentic-interaction";
import type {
  LocalLLMProviderPort,
  ModelLifecyclePort,
  SendStructuredRequestPort,
  WebGPUDetectorPort,
  HardwareProfilerPort,
  ChatPersistencePort,
} from "@hexagen/local-llm";
import { HandleServerChatUseCase } from "@hexagen/agentic-interaction";
import {
  CvaVariantResolverAdapter,
  DefaultNodeVisualMapperAdapter,
  MapNodeVisualUseCase,
} from "@hexagen/ui-projection-compiler";
import type { MapNodeVisualPort } from "@hexagen/ui-projection-compiler";
import {
  DagreGraphLayoutAdapter,
  SolveGraphLayoutUseCase,
} from "@hexagen/layout-engine";
import {
  LocalStoragePersistenceAdapter,
  LocalStorageCanvasLayoutAdapter,
  ArchitectureGraphProviderAdapter,
  EphemeralSecretVaultAdapter,
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
  IDBChatPersistenceAdapter,
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

  // Architecture graph provider port → concrete adapter instance
  registry.set(
    "ArchitectureGraphProviderPort",
    new ArchitectureGraphProviderAdapter() satisfies IArchitectureGraphProviderPort,
  );

  // Hexagonal map generator port → concrete adapter instance
  registry.set(
    "GenerateHexagonalMapPort",
    new HexagonalMapGeneratorAdapter() satisfies GenerateHexagonalMapPort,
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
  registry.set(
    "ModelLifecyclePort",
    localLLMAdapter satisfies ModelLifecyclePort,
  );
  registry.set(
    "SendStructuredRequestPort",
    localLLMAdapter satisfies SendStructuredRequestPort,
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

  // Chat Persistence → IndexedDB adapter
  registry.set(
    "ChatPersistencePort",
    new IDBChatPersistenceAdapter() satisfies ChatPersistencePort,
  );

  // Secret Vault → ephemeral in-memory adapter
  registry.set(
    "SecretVaultPort",
    new EphemeralSecretVaultAdapter() satisfies SecretVaultPort,
  );

  // Projection compiler → canvas rendering pipeline
  const variantResolver = new CvaVariantResolverAdapter();
  const mapNodeVisualPort: MapNodeVisualPort =
    new DefaultNodeVisualMapperAdapter(variantResolver);
  const mapNodeVisualUseCase = new MapNodeVisualUseCase(mapNodeVisualPort);
  registry.set("MapNodeVisualUseCase", mapNodeVisualUseCase);

  // Graph layout → dagre-based auto-layout
  const dagreGraphLayoutAdapter = new DagreGraphLayoutAdapter();
  const solveGraphLayoutUseCase = new SolveGraphLayoutUseCase(
    dagreGraphLayoutAdapter,
  );
  registry.set("SolveGraphLayoutUseCase", solveGraphLayoutUseCase);

  // Server LLM Request Port -> dedicated use case
  const defaultModel = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";
  registry.set(
    "ServerLLMRequestPort",
    new HandleServerChatUseCase(
      registry.get("LLMProviderPort") as LLMProviderPort,
      defaultModel,
    ) satisfies ServerLLMRequestPort,
  );

  // TODO: Wire REM context when app-level intent tracking available (Phase 3)
  // REM (RuleExecutionManifest) will be integrated when UI layer event streams are available
  // const rem = buildRuntimeExecutionManifest(manifest);
  // const lineage = getCurrentIntentLineage();
  // const transactionManager = new InMemoryTransactionManagerAdapter();
  // const executeTransactionUseCase = new ExecuteTransactionUseCase(transactionManager);
  // registry.set("ExecuteTransactionUseCase", executeTransactionUseCase);

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

export const getModelLifecycle = () =>
  dependencies.get<ModelLifecyclePort>("ModelLifecyclePort");

export const getSendStructuredRequest = () =>
  dependencies.get<SendStructuredRequestPort>("SendStructuredRequestPort");

export const getWebGPUDetector = () =>
  dependencies.get<WebGPUDetectorPort>("WebGPUDetectorPort");

export const getHardwareProfiler = () =>
  dependencies.get<HardwareProfilerPort>("HardwareProfilerPort");

export const getChatPersistence = () =>
  dependencies.get<ChatPersistencePort>("ChatPersistencePort");

export const getSecretVault = () =>
  dependencies.get<SecretVaultPort>("SecretVaultPort");

export const getServerLLMRequestPort = () =>
  dependencies.get<ServerLLMRequestPort>("ServerLLMRequestPort");

export const getMapNodeVisualUseCase = () =>
  dependencies.get<MapNodeVisualUseCase>("MapNodeVisualUseCase");

export const getGenerateHexagonalMapUseCase = () =>
  dependencies.get<GenerateHexagonalMapPort>("GenerateHexagonalMapPort");

export const getSolveGraphLayoutUseCase = () =>
  dependencies.get<SolveGraphLayoutUseCase>("SolveGraphLayoutUseCase");
