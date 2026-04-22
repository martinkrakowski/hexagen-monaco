import { v4 as uuidv4 } from "uuid";
import type { BoundedContext } from "@hexagen/project-configuration";

/**
 * Factory for a fresh BoundedContext with sensible defaults.
 * Previously this was a 30-line inline object literal inside
 * handleAddContext — extracting it keeps the step component clean
 * and documents the "empty shape" explicitly.
 */
export function createEmptyContext(): BoundedContext {
  return {
    id: uuidv4(),
    name: "",
    description: "",
    infrastructureTarget: "nestjs",
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
    uiFramework: "",
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
