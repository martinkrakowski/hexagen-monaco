/**
 * @module port-names
 * @description Compile-time safe port identifiers for the dependency injection registry.
 *
 * This module centralizes all port names used across wire composition layers.
 * Usage: Always use PORT_NAMES constants instead of magic strings.
 *
 * @convention Use PORT_NAMES.<NAME> when registering or retrieving ports from the registry.
 * @safety TypeScript enforces availability at compile-time; ports must be defined here first.
 * @example
 *   registry.set(PORT_NAMES.MONACO_PERSISTENCE, adapter);
 *   const adapter = registry.get(PORT_NAMES.MONACO_PERSISTENCE);
 */

/**
 * All port identifiers, grouped by domain for clarity.
 * Each entry maps the constant name (SCREAMING_SNAKE_CASE) to the string identifier.
 */
export const PORT_NAMES = {
  // ============================================================================
  // Persistence Ports (Storage & Caching)
  // ============================================================================
  /** Monaco editor state persistence (localStorage) */
  MONACO_PERSISTENCE: "MonacoPersistencePort",
  /** Wizard session state persistence (localStorage) */
  WIZARD_PERSISTENCE: "WizardPersistencePort",
  /** Editor workspace layout persistence (localStorage) */
  EDITOR_WORKSPACE_PERSISTENCE: "EditorWorkspacePersistencePort",
  /** Canvas layout and viewport state persistence (localStorage) */
  CANVAS_LAYOUT_PERSISTENCE: "CanvasLayoutPersistencePort",
  /** Chat history and conversation storage (IndexedDB) */
  CHAT_PERSISTENCE: "ChatPersistencePort",

  // ============================================================================
  // Infrastructure Ports (Logging, Messaging, Buses)
  // ============================================================================
  /** Application-wide logger for diagnostics and monitoring */
  LOGGER: "LoggerPort",
  /** Event bus for cross-domain pub/sub messaging */
  EVENT_BUS: "EventBusPort",
  /** Intent bus for user action/intent dispatch */
  INTENT_BUS: "IntentBusPort",

  // ============================================================================
  // Architecture & Visualization Ports
  // ============================================================================
  /** Architecture graph data provider (reads manifest structure) */
  ARCHITECTURE_GRAPH_PROVIDER: "ArchitectureGraphProviderPort",
  /** Hexagonal map SVG/canvas generator for visualization */
  GENERATE_HEXAGONAL_MAP: "GenerateHexagonalMapPort",

  // ============================================================================
  // LLM & AI Ports (Cloud, Local, Structured Generation)
  // ============================================================================
  /** Cloud LLM provider (OpenAI, Anthropic, etc.) */
  LLM_PROVIDER: "LLMProviderPort",
  /** Local WebLLM browser-based inference */
  LOCAL_LLM_PROVIDER: "LocalLLMProviderPort",
  /** Model lifecycle management (load, unload, status) */
  MODEL_LIFECYCLE: "ModelLifecyclePort",
  /** Structured request generation and parsing */
  SEND_STRUCTURED_REQUEST: "SendStructuredRequestPort",
  /** Server-side LLM request handling */
  SERVER_LLM_REQUEST: "ServerLLMRequestPort",

  // ============================================================================
  // Hardware & Browser Capability Ports
  // ============================================================================
  /** WebGPU availability detection */
  WEBGPU_DETECTOR: "WebGPUDetectorPort",
  /** Hardware profiling (GPU, CPU, memory) */
  HARDWARE_PROFILER: "HardwareProfilerPort",

  // ============================================================================
  // Security Ports (Vaults, Secrets)
  // ============================================================================
  /** User secret vault for API keys and credentials */
  SECRET_VAULT: "SecretVaultPort",

  // ============================================================================
  // UI & Rendering Ports (Projections, Layouts)
  // ============================================================================
  /** Map semantic nodes to visual components and properties */
  MAP_NODE_VISUAL_USE_CASE: "MapNodeVisualUseCase",
  /** Solve graph auto-layout (dagre, ELK, etc.) */
  SOLVE_GRAPH_LAYOUT_USE_CASE: "SolveGraphLayoutUseCase",
} as const;

/**
 * Type-safe port name union.
 * @example typeof PORT_NAMES[keyof typeof PORT_NAMES]
 */
export type PortName = (typeof PORT_NAMES)[keyof typeof PORT_NAMES];

/**
 * Validator for runtime port name safety.
 * @param portName The port identifier to validate
 * @returns true if portName is a recognized PORT_NAMES value
 * @example
 *   if (!isValidPortName(portName)) {
 *     throw new Error(`Unknown port: ${portName}`);
 *   }
 */
export const isValidPortName = (portName: unknown): portName is PortName => {
  if (typeof portName !== "string") return false;
  return Object.values(PORT_NAMES).includes(portName as PortName);
};
