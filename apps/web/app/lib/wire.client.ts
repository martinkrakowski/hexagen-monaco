// apps/web/app/lib/wire.client.ts
// Client-only wiring — all browser adapters + all client getters
// Safe to import in Next.js client components

import { PORT_NAMES } from "@hexagen/web-driver";
import type { ProjectDiscardedEvent } from "@hexagen/monaco-orchestration";
import type { DomainEvent } from "@hexagen/messaging";
import { useGovernanceThreadStore } from "../../features/governance-assistant/stores/useGovernanceThreadStore";

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
import { WebLlmMessagingAdapter } from "./adapters/web-llm-messaging.adapter";
import {
  CvaVariantResolverAdapter,
  DefaultNodeVisualMapperAdapter,
  MapNodeVisualUseCase,
} from "@hexagen/ui-projection-compiler";
import type { MapNodeVisualPort } from "@hexagen/ui-projection-compiler";
import {
  ElkGraphLayoutAdapter,
  SolveGraphLayoutUseCase,
} from "@hexagen/layout-engine";
import type { UserSecretVaultPort } from "@hexagen/web-driver";
import {
  LocalStoragePersistenceAdapter,
  LocalStorageCanvasLayoutAdapter,
  ArchitectureGraphProviderAdapter,
  EphemeralSecretVaultAdapter,
} from "@hexagen/web-driver";
import {
  WebLLMAdapter,
  WebGPUCapabilityAdapter,
  BrowserHardwareProfilerAdapter,
  IDBChatPersistenceAdapter,
} from "@hexagen/local-llm";
import {
  LocalLlmGenerationAdapter,
  ClientManifestGenerationUseCase,
  ServerManifestGenerationUseCase,
} from "@hexagen/manifest-generation";

import {
  createWebLogger,
  createEventBus,
  createIntentBus,
  createLLMProvider,
} from "./wire.shared";

/**
 * Simple registry-based composition for ports used by web-driver use-cases.
 * Intent Bus / projections / components consume via typed getters.
 */
export const wireDependencies = () => {
  const registry = new Map<string, unknown>();

  // Monaco persistence port → concrete localStorage adapter
  const localStorageAdapter = new LocalStoragePersistenceAdapter();
  registry.set(
    PORT_NAMES.MONACO_PERSISTENCE,
    localStorageAdapter satisfies MonacoPersistencePort,
  );

  // Wizard persistence port → same localStorage adapter
  registry.set(
    PORT_NAMES.WIZARD_PERSISTENCE,
    localStorageAdapter satisfies WizardPersistencePort,
  );

  // Editor workspace persistence port → same localStorage adapter
  registry.set(
    PORT_NAMES.EDITOR_WORKSPACE_PERSISTENCE,
    localStorageAdapter satisfies EditorWorkspacePersistencePort,
  );

  // Canvas layout persistence port → dedicated adapter
  const canvasLayoutAdapter = new LocalStorageCanvasLayoutAdapter();
  registry.set(
    PORT_NAMES.CANVAS_LAYOUT_PERSISTENCE,
    canvasLayoutAdapter satisfies CanvasLayoutPersistencePort,
  );

  // Logger port → console logger for web app
  registry.set(PORT_NAMES.LOGGER, createWebLogger() satisfies LoggerPort);

  // Architecture graph provider port → concrete adapter instance
  registry.set(
    PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
    new ArchitectureGraphProviderAdapter() satisfies IArchitectureGraphProviderPort,
  );

  // Hexagonal map generator port → concrete adapter instance
  registry.set(
    PORT_NAMES.GENERATE_HEXAGONAL_MAP,
    new HexagonalMapGeneratorAdapter() satisfies GenerateHexagonalMapPort,
  );

  // Event Bus → in-memory implementation
  registry.set(PORT_NAMES.EVENT_BUS, createEventBus() satisfies EventBusPort);

  // Intent Bus → in-memory implementation
  registry.set(
    PORT_NAMES.INTENT_BUS,
    createIntentBus() satisfies IntentBusPort,
  );

  // LLM Provider → server adapter with env config
  registry.set(
    PORT_NAMES.LLM_PROVIDER,
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
    PORT_NAMES.LOCAL_LLM_PROVIDER,
    localLLMAdapter satisfies LocalLLMProviderPort,
  );
  registry.set(
    PORT_NAMES.MODEL_LIFECYCLE,
    localLLMAdapter satisfies ModelLifecyclePort,
  );
  registry.set(
    PORT_NAMES.SEND_STRUCTURED_REQUEST,
    localLLMAdapter satisfies SendStructuredRequestPort,
  );

  // WebGPU Detector → browser capability adapter
  registry.set(
    PORT_NAMES.WEBGPU_DETECTOR,
    new WebGPUCapabilityAdapter() satisfies WebGPUDetectorPort,
  );

  // Hardware Profiler → browser hardware detection adapter
  registry.set(
    PORT_NAMES.HARDWARE_PROFILER,
    new BrowserHardwareProfilerAdapter() satisfies HardwareProfilerPort,
  );

  // Chat Persistence → IndexedDB adapter with event subscription
  const chatPersistence = new IDBChatPersistenceAdapter();
  registry.set(
    PORT_NAMES.CHAT_PERSISTENCE,
    chatPersistence satisfies ChatPersistencePort,
  );

  // Subscribe to ProjectDiscarded events for automatic cleanup
  const eventBus = registry.get(PORT_NAMES.EVENT_BUS) as EventBusPort;
  eventBus.subscribe<ProjectDiscardedEvent>(
    "ProjectDiscarded",
    (event: DomainEvent<ProjectDiscardedEvent>) => {
      // Clear IndexedDB persistence
      void chatPersistence
        .purgeProjectData(event.payload.projectId)
        .catch((err) =>
          console.error("Failed to purge chat persistence data:", err),
        );

      // Clear Zustand thread store
      useGovernanceThreadStore.getState().clearAllThreads();
    },
  );

  // Secret Vault → ephemeral in-memory adapter (browser-side user vault)
  registry.set(
    PORT_NAMES.SECRET_VAULT,
    new EphemeralSecretVaultAdapter() satisfies UserSecretVaultPort,
  );

  // Projection compiler → canvas rendering pipeline
  const variantResolver = new CvaVariantResolverAdapter();
  const mapNodeVisualPort: MapNodeVisualPort =
    new DefaultNodeVisualMapperAdapter(variantResolver);
  const mapNodeVisualUseCase = new MapNodeVisualUseCase(mapNodeVisualPort);
  registry.set(PORT_NAMES.MAP_NODE_VISUAL_USE_CASE, mapNodeVisualUseCase);

  // Graph layout → ELK-based auto-layout
  const elkGraphLayoutAdapter = new ElkGraphLayoutAdapter();
  const solveGraphLayoutUseCase = new SolveGraphLayoutUseCase(
    elkGraphLayoutAdapter,
  );
  registry.set(PORT_NAMES.SOLVE_GRAPH_LAYOUT_USE_CASE, solveGraphLayoutUseCase);

  // Server LLM Request Port -> dedicated use case
  const defaultModel = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";
  registry.set(
    PORT_NAMES.SERVER_LLM_REQUEST,
    new HandleServerChatUseCase(
      registry.get(PORT_NAMES.LLM_PROVIDER) as LLMProviderPort,
      defaultModel,
    ) satisfies ServerLLMRequestPort,
  );

  // Client Manifest Generation → Local LLM adapter wired to use case
  const webLlmMessagingAdapter = new WebLlmMessagingAdapter(localLLMAdapter);
  const localLlmMessagingAdapter = new LocalLlmGenerationAdapter(
    webLlmMessagingAdapter,
  );
  const clientManifestGenerationUseCase = new ClientManifestGenerationUseCase(
    localLlmMessagingAdapter,
  );
  registry.set(
    PORT_NAMES.CLIENT_MANIFEST_GENERATION,
    clientManifestGenerationUseCase,
  );

  // Server Manifest Generation → API-based use case
  const serverManifestGenerationUseCase = new ServerManifestGenerationUseCase();
  registry.set(
    PORT_NAMES.SERVER_MANIFEST_GENERATION,
    serverManifestGenerationUseCase,
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
  dependencies.get<MonacoPersistencePort>(PORT_NAMES.MONACO_PERSISTENCE);

export const getArchitectureGraphProvider = () =>
  dependencies.get<IArchitectureGraphProviderPort>(
    PORT_NAMES.ARCHITECTURE_GRAPH_PROVIDER,
  );

export const getLogger = () => dependencies.get<LoggerPort>(PORT_NAMES.LOGGER);

export const getEventBus = () =>
  dependencies.get<EventBusPort>(PORT_NAMES.EVENT_BUS);

export const getIntentBus = () =>
  dependencies.get<IntentBusPort>(PORT_NAMES.INTENT_BUS);

export const getLLMProvider = () =>
  dependencies.get<LLMProviderPort>(PORT_NAMES.LLM_PROVIDER);

export const getWizardPersistence = () =>
  dependencies.get<WizardPersistencePort>(PORT_NAMES.WIZARD_PERSISTENCE);

export const getEditorWorkspacePersistence = () =>
  dependencies.get<EditorWorkspacePersistencePort>(
    PORT_NAMES.EDITOR_WORKSPACE_PERSISTENCE,
  );

export const getCanvasLayoutPersistence = () =>
  dependencies.get<CanvasLayoutPersistencePort>(
    PORT_NAMES.CANVAS_LAYOUT_PERSISTENCE,
  );

export const getLocalLLMProvider = () =>
  dependencies.get<LocalLLMProviderPort>(PORT_NAMES.LOCAL_LLM_PROVIDER);

export const getModelLifecycle = () =>
  dependencies.get<ModelLifecyclePort>(PORT_NAMES.MODEL_LIFECYCLE);

export const getSendStructuredRequest = () =>
  dependencies.get<SendStructuredRequestPort>(
    PORT_NAMES.SEND_STRUCTURED_REQUEST,
  );

export const getWebGPUDetector = () =>
  dependencies.get<WebGPUDetectorPort>(PORT_NAMES.WEBGPU_DETECTOR);

export const getHardwareProfiler = () =>
  dependencies.get<HardwareProfilerPort>(PORT_NAMES.HARDWARE_PROFILER);

export const getChatPersistence = () =>
  dependencies.get<ChatPersistencePort>(PORT_NAMES.CHAT_PERSISTENCE);

export const getSecretVault = () =>
  dependencies.get<UserSecretVaultPort>(PORT_NAMES.SECRET_VAULT);

export const getServerLLMRequestPort = () =>
  dependencies.get<ServerLLMRequestPort>(PORT_NAMES.SERVER_LLM_REQUEST);

export const getMapNodeVisualUseCase = () =>
  dependencies.get<MapNodeVisualUseCase>(PORT_NAMES.MAP_NODE_VISUAL_USE_CASE);

export const getGenerateHexagonalMapUseCase = () =>
  dependencies.get<GenerateHexagonalMapPort>(PORT_NAMES.GENERATE_HEXAGONAL_MAP);

export const getSolveGraphLayoutUseCase = () =>
  dependencies.get<SolveGraphLayoutUseCase>(
    PORT_NAMES.SOLVE_GRAPH_LAYOUT_USE_CASE,
  );

export const getClientManifestGenerationUseCase = () =>
  dependencies.get<ClientManifestGenerationUseCase>(
    PORT_NAMES.CLIENT_MANIFEST_GENERATION,
  );

export const getServerManifestGenerationUseCase = () =>
  dependencies.get<ServerManifestGenerationUseCase>(
    PORT_NAMES.SERVER_MANIFEST_GENERATION,
  );

/**
 * Check if server LLM provider has valid cloud API key configured.
 * Synchronously checks environment variables at app init time.
 * Used for immediate (Tier 1) button gating before async BYOK probe (Tier 2).
 * @returns true if NEXT_PUBLIC_LLM_API_KEY is set and non-empty
 */
export const hasServerLLMAccessKey = (): boolean => {
  const provider = getLLMProvider() as {
    hasAccessKey?: () => boolean;
  };
  return typeof provider.hasAccessKey === "function" && provider.hasAccessKey();
};
