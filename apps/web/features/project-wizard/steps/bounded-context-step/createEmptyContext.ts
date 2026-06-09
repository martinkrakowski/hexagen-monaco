import { v4 as uuidv4 } from "uuid";
import type { BoundedContext } from "@hexagen/project-configuration";

/**
 * The project-level Applications selection (ADR-0041) a new context inherits.
 * UI/API are project-wide, not per-context: the Bounded Contexts step reads the
 * current selection (collapsed from existing contexts) and passes it here so a
 * context created after the Applications step carries the project's choice. The
 * defaults match the single-app preset (Next.js + nestjs) when none is supplied.
 */
export interface ContextDefaults {
  uiFramework?: BoundedContext["uiFramework"];
  infrastructureTarget?: BoundedContext["infrastructureTarget"];
}

/**
 * Factory for a fresh BoundedContext with sensible defaults.
 * Previously this was a 30-line inline object literal inside
 * handleAddContext — extracting it keeps the step component clean
 * and documents the "empty shape" explicitly.
 */
export function createEmptyContext(
  defaults: ContextDefaults = {},
): BoundedContext {
  return {
    id: uuidv4(),
    name: "",
    description: "",
    infrastructureTarget: defaults.infrastructureTarget ?? "nestjs",
    coreDomainEntities: [],
    valueObjects: [],
    domainEvents: [],
    entities: [],
    useCases: [],
    portConfiguration: {
      inboundPorts: [],
      outboundPorts: [],
    },
    apiFramework: "NestJS",
    uiFramework: defaults.uiFramework ?? "Next.js",
    persistenceAdapter: "",
    messagingAdapter: "",
    telemetryProvider: "",
    externalApiPorts: [],
    llmProviders: [],
    blockchainNetworks: [],
    authenticationProvider: "",
    emailService: "",
    paymentGateway: "",
    storageProvider: "",
    searchService: "",
    webhookEndpoints: [],
  };
}
