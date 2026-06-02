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
  SavedProjectsPersistencePort,
  WizardPersistencePort,
  GenerationResultPersistencePort,
  PersistenceDomainRegistryPort,
} from "@hexagen/shared";

import type { LoggerPort } from "@hexagen/shared";
import { logger } from "../../lib/structured-logger";
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
  LocalStorageMonacoAdapter,
  LocalStorageCanvasLayoutAdapter,
  ArchitectureGraphProviderAdapter,
  EphemeralSecretVaultAdapter,
  IDBGenerationResultAdapter,
  MigrationOrchestrator,
  PersistenceDomainRegistry,
  WizardDraftMigrationStep,
  SavedProjectsMigrationStep,
  SavedProjectsV3MigrationStep,
  EditorWorkspaceMigrationStep,
} from "@hexagen/web-driver";
import { IDBWizardDraftAdapter } from "./adapters/idb-wizard-draft.adapter";
import { IDBSavedProjectsAdapter } from "./adapters/idb-saved-projects.adapter";
import { IDBEditorWorkspaceAdapter } from "./adapters/idb-editor-workspace.adapter";
import type { StorageQuotaMonitor } from "@hexagen/web-driver";
import { getStorageQuotaMonitor as createStorageQuotaMonitor } from "@hexagen/web-driver";
import {
  setHardwareProfiler,
  type HardwareProfiler,
} from "@hexagen/model-settings";
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
  ExecuteStructuredConfigGenerationUseCase,
  ExecuteLooseSpecConversionUseCase,
} from "@hexagen/agentic-interaction";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";

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

  // Monaco persistence port → dedicated localStorage adapter
  const monacoAdapter = new LocalStorageMonacoAdapter();
  registry.set(
    PORT_NAMES.MONACO_PERSISTENCE,
    monacoAdapter satisfies MonacoPersistencePort,
  );

  // Wizard persistence port → IDB-backed adapter (project-scoped)
  const wizardPersistence = new IDBWizardDraftAdapter("default");
  registry.set(
    PORT_NAMES.WIZARD_PERSISTENCE,
    wizardPersistence satisfies WizardPersistencePort,
  );

  // Editor workspace persistence port → IDB-backed adapter
  const editorWorkspaceAdapter = new IDBEditorWorkspaceAdapter();
  registry.set(
    PORT_NAMES.EDITOR_WORKSPACE_PERSISTENCE,
    editorWorkspaceAdapter satisfies EditorWorkspacePersistencePort,
  );

  // Canvas layout persistence port → dedicated adapter
  const canvasLayoutAdapter = new LocalStorageCanvasLayoutAdapter();
  registry.set(
    PORT_NAMES.CANVAS_LAYOUT_PERSISTENCE,
    canvasLayoutAdapter satisfies CanvasLayoutPersistencePort,
  );

  // Saved projects persistence port → IDB-backed adapter
  const savedProjectsAdapter = new IDBSavedProjectsAdapter();
  registry.set(
    PORT_NAMES.SAVED_PROJECTS_PERSISTENCE,
    savedProjectsAdapter satisfies SavedProjectsPersistencePort,
  );

  // Generation result persistence port → IDB adapter
  const generationResultAdapter = new IDBGenerationResultAdapter();
  registry.set(
    PORT_NAMES.GENERATION_RESULT_PERSISTENCE,
    generationResultAdapter satisfies GenerationResultPersistencePort,
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

  // Wire hardware profiler into model-settings hook (DI injection)
  if (typeof window !== "undefined") {
    setHardwareProfiler(
      () =>
        registry.get(
          PORT_NAMES.HARDWARE_PROFILER,
        ) as unknown as HardwareProfiler,
    );
  }

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
          logger.error("Failed to purge chat persistence data:", {
            error: err,
          }),
        );

      // Clear generation results
      void generationResultAdapter
        .purgeProjectResults(event.payload.projectId)
        .catch((err) =>
          logger.error("Failed to purge generation results:", { error: err }),
        );

      // Clear Zustand thread store
      useGovernanceThreadStore.getState().clearAllThreads();
    },
  );

  // Persistence Domain Registry → singleton
  const domainRegistry = new PersistenceDomainRegistry();
  registry.set(
    PORT_NAMES.PERSISTENCE_DOMAIN_REGISTRY,
    domainRegistry satisfies PersistenceDomainRegistryPort,
  );

  // Migration orchestrator → runs pending LS→IDB migrations on boot
  const wizardPersistenceAdapter = registry.get(
    PORT_NAMES.WIZARD_PERSISTENCE,
  ) as WizardPersistencePort;
  const migrationOrchestrator = new MigrationOrchestrator([
    new WizardDraftMigrationStep(wizardPersistenceAdapter),
    new SavedProjectsMigrationStep(savedProjectsAdapter, domainRegistry),
    new SavedProjectsV3MigrationStep(savedProjectsAdapter),
    new EditorWorkspaceMigrationStep(editorWorkspaceAdapter, domainRegistry),
  ]);
  void migrationOrchestrator
    .runPending()
    .catch((err) =>
      logger.error("Migration orchestrator failed:", { error: err }),
    );

  // Secret Vault → ephemeral in-memory adapter (browser-side user vault)
  registry.set(
    PORT_NAMES.SECRET_VAULT,
    new EphemeralSecretVaultAdapter() satisfies UserSecretVaultPort,
  );

  // Storage Quota Monitor → singleton
  const storageQuotaMonitor = createStorageQuotaMonitor();
  registry.set(
    PORT_NAMES.STORAGE_QUOTA_MONITOR,
    storageQuotaMonitor satisfies StorageQuotaMonitor,
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

  // Transaction Manager → Singleton in-memory state
  const transactionManager = new InMemoryTransactionManager();
  registry.set(PORT_NAMES.TRANSACTION_MANAGER, transactionManager);

  // Client Spec Generation → Local LLM adapter with in-memory transaction manager
  const clientSpecGenerationUseCase =
    new ExecuteStructuredConfigGenerationUseCase(
      localLLMAdapter,
      transactionManager,
    );
  registry.set(PORT_NAMES.CLIENT_SPEC_GENERATION, clientSpecGenerationUseCase);

  // Client Loose Spec Conversion
  const clientLooseSpecConversionUseCase =
    new ExecuteLooseSpecConversionUseCase(localLLMAdapter);
  registry.set(
    PORT_NAMES.CLIENT_LOOSE_SPEC_CONVERSION,
    clientLooseSpecConversionUseCase,
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
    migrationReady: migrationOrchestrator.ready,
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

export const getSavedProjectsPersistence = () =>
  dependencies.get<SavedProjectsPersistencePort>(
    PORT_NAMES.SAVED_PROJECTS_PERSISTENCE,
  );

export const getGenerationResultPersistence = () =>
  dependencies.get<GenerationResultPersistencePort>(
    PORT_NAMES.GENERATION_RESULT_PERSISTENCE,
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

export function getClientSpecGenerationUseCase(): ExecuteStructuredConfigGenerationUseCase {
  if (typeof window === "undefined") {
    throw new Error(
      "getClientSpecGenerationUseCase called in non-browser context",
    );
  }
  return dependencies.get<ExecuteStructuredConfigGenerationUseCase>(
    PORT_NAMES.CLIENT_SPEC_GENERATION,
  );
}

export function getClientLooseSpecConversionUseCase(): ExecuteLooseSpecConversionUseCase {
  if (typeof window === "undefined") {
    throw new Error(
      "getClientLooseSpecConversionUseCase called in non-browser context",
    );
  }
  return dependencies.get<ExecuteLooseSpecConversionUseCase>(
    PORT_NAMES.CLIENT_LOOSE_SPEC_CONVERSION,
  );
}

export const getStorageQuotaMonitor = () =>
  dependencies.get<StorageQuotaMonitor>(PORT_NAMES.STORAGE_QUOTA_MONITOR);

export const getMigrationReady = (): Promise<void> =>
  dependencies.migrationReady;

export const getPersistenceDomainRegistry = () =>
  dependencies.get<PersistenceDomainRegistryPort>(
    PORT_NAMES.PERSISTENCE_DOMAIN_REGISTRY,
  );

export function isLocalLLMReady(): boolean {
  const lifecycle = dependencies.get<ModelLifecyclePort>(
    PORT_NAMES.MODEL_LIFECYCLE,
  );
  return lifecycle.getLoadedModel() !== null;
}

/**
 * Check if server LLM provider has valid cloud API key configured.
 * Synchronously checks environment variables at app init time.
 * Used for immediate (Tier 1) button gating before async BYOK probe (Tier 2).
 * @returns true if the build-time NEXT_PUBLIC_LLM_AVAILABLE flag is "true"
 */
export const hasServerLLMAccessKey = (): boolean => {
  return process.env.NEXT_PUBLIC_LLM_AVAILABLE === "true";
};

/**
 * Check if using a free tier model with rate limiting.
 * Synchronously checks environment variables at app init time.
 * @returns true if the build-time NEXT_PUBLIC_FREE_TIER_MODEL flag is "true"
 */
export const isFreeTierModel = (): boolean => {
  return process.env.NEXT_PUBLIC_FREE_TIER_MODEL === "true";
};
