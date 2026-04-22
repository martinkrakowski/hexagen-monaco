/**
 * NodeKind enum - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

export enum NodeKind {
  // Core structural elements
  BoundedContext = "BoundedContext",
  Entity = "Entity",
  ValueObject = "ValueObject",
  Port = "Port",
  UseCase = "UseCase",
  Adapter = "Adapter",
  Driver = "Driver",

  // Infrastructure elements
  PersistenceAdapter = "PersistenceAdapter",
  MessagingAdapter = "MessagingAdapter",
  ExternalIntegrationAdapter = "ExternalIntegrationAdapter",

  // Application elements
  Controller = "Controller",
  Presenter = "Presenter",
  Gateway = "Gateway",

  // Domain elements
  Aggregate = "Aggregate",
  DomainEvent = "DomainEvent",
  Policy = "Policy",

  // Specialized elements
  Repository = "Repository",
  Factory = "Factory",
  Service = "Service",

  // Extensibility point
  Extension = "Extension",
}

// Runtime type guard moved to @hexagen/runtime
// Use isNodeKind() from @hexagen/runtime instead
