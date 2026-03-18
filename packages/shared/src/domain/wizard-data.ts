/** DDD relationship types used to classify cross-context dependencies. */
export type ContextRelationshipType = "U" | "D" | "ACL" | "SK" | "P" | "OHS";

/**
 * A domain event reference — a named signal that a Bounded Context publishes
 * or subscribes to. IDs use the stable format `pub_{bcId}_{index}` /
 * `sub_{bcId}_{index}` to avoid collisions across contexts.
 */
export interface DomainEventRef {
  id: string;
  label: string;
}

/**
 * Represents a peer Bounded Context in the strategic landscape.
 * Rendered in the outer orbit ring, distinct from infrastructure adapters.
 */
export interface ExternalContext {
  id: string;
  name: string;
  relationshipType: ContextRelationshipType;
  isEventDriven?: boolean;
  entityNames?: string[];
  useCaseNames?: string[];
  publishedEvents?: DomainEventRef[];
  subscribedEvents?: DomainEventRef[];
}

/**
 * Represents a Bounded Context within this project.
 * Each context has its own infrastructure and domain configuration.
 */
export interface BoundedContext {
  id: string;
  name: string;
  /** Inbound API driver */
  apiFramework?: string;
  /** Inbound UI driver */
  uiFramework?: string;
  /** Outbound persistence adapter */
  persistenceAdapter?: string;
  /** Outbound messaging adapter */
  messagingAdapter?: string;
  /** Telemetry provider */
  telemetryProvider?: string;
  /** External API ports */
  externalApiPorts?: string[];
  /** LLM providers (if withLlm addon) */
  llmProviders?: string[];
  /** Blockchain networks (if withBlockchain addon) */
  blockchainNetworks?: string[];
  /** Authentication provider */
  authenticationProvider?: string;
  /** Email service */
  emailService?: string;
  /** Payment gateway */
  paymentGateway?: string;
  /** Storage provider */
  storageProvider?: string;
  /** Search service */
  searchService?: string;
  /** Webhook endpoints */
  webhookEndpoints?: string[];
  /** Domain entities */
  entities?: string[];
  /** Domain use cases */
  useCases?: string[];
  /** Domain events published */
  publishedEvents?: DomainEventRef[];
  /** Domain events subscribed */
  subscribedEvents?: DomainEventRef[];
}

/**
 * WizardData is the input port between the project wizard (controller layer)
 * and the canvas visualization use case. It represents the in-progress state
 * of the wizard at any step — all fields are optional because the diagram
 * renders incrementally as the user fills each step.
 */
export interface WizardData {
  /** Project-wide workspace scope */
  workspaceScope?: string;
  /** Project-level addons */
  withLlm?: boolean;
  withBlockchain?: boolean;
  /** Strategic landscape: peer Bounded Contexts in the outer orbit ring */
  externalContexts?: ExternalContext[];
  /** Multiple Bounded Contexts within this project */
  boundedContexts?: BoundedContext[];
}
