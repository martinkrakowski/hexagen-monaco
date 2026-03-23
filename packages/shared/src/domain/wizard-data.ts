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
  publishedEvents?: Array<{ id: string; label: string }>;
  subscribedEvents?: Array<{ id: string; label: string }>;
}

/**
 * Represents a Bounded Context within this project.
 * Each context has its own infrastructure and domain configuration.
 */
export interface BoundedContext {
  id: string;
  name: string;
  description?: string;
  // Infrastructure Target (required)
  infrastructureTarget: "nestjs" | "express" | "serverless" | "plain-ts";
  // Core Domain Entities (required - comprehensive data collection)
  coreDomainEntities: string[];
  // Value Objects (immutable objects defined by attributes)
  valueObjects: string[];
  // Domain Events (things that happened in the domain)
  domainEvents: string[];
  // Domain Entities (legacy - backward compatibility)
  entities?: string[];
  // Domain Use Cases
  useCases?: string[];
  // Port Configuration (maps to React Flow N/S/E/W handles) (required)
  portConfiguration: {
    // Feeds West (Driving Ports) & North (Presentation Adapters)
    inboundPorts: (
      | "rest-controller"
      | "graphql-resolver"
      | "event-listener"
      | "cli-command"
    )[];
    // Feeds East (Driven Ports) & South (Infrastructure Adapters)
    outboundPorts: (
      | "relational-db"
      | "document-db"
      | "external-service-client"
      | "message-publisher"
    )[];
  };
  // Inbound API Driver (West handle) (required)
  apiFramework: "Fastify" | "Express" | "NestJS";
  // Inbound UI Driver (North handle) (required)
  uiFramework: "Next.js" | "React Router" | "Remix" | "Angular" | "Vue.js";
  // Outbound Persistence Adapter (South handle) (required)
  persistenceAdapter: "Prisma" | "TypeORM" | "Mongoose" | "Drizzle";
  // Outbound Messaging Adapter (South handle) (required)
  messagingAdapter: "BullMQ" | "Temporal" | "RabbitMQ";
  // Telemetry Provider (South handle) (required)
  telemetryProvider: "OpenTelemetry" | "None" | "Prometheus" | "Winston";
  // External API Ports (outbound port) (required)
  externalApiPorts: string[];
  // LLM Providers (outbound port) (required)
  llmProviders: string[];
  // Blockchain Networks (outbound port) (required)
  blockchainNetworks: string[];
  // Authentication Provider (outbound port) (required)
  authenticationProvider: string;
  // Email Service (outbound port) (required)
  emailService: string;
  // Payment Gateway (outbound port) (required)
  paymentGateway: string;
  // Storage Provider (outbound port) (required)
  storageProvider: string;
  // Search Service (outbound port) (required)
  searchService: string;
  // Webhook Endpoints (outbound port) (required)
  webhookEndpoints: string[];
  // Events (required)
  publishedEvents: Array<{ id: string; label: string }>;
  subscribedEvents: Array<{ id: string; label: string }>;
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
