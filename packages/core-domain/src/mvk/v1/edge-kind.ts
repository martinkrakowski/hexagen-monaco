/**
 * EdgeKind enum - MVK v1
 * 
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

export enum EdgeKind {
  // Structural relationships
  Composition = "Composition",
  Aggregation = "Aggregation",
  Dependency = "Dependency",
  Inheritance = "Inheritance",
  Realization = "Realization",

  // Behavioral relationships
  Invocation = "Invocation",
  Subscription = "Subscription",
  Implementation = "Implementation",

  // Dependency relationships
  Usage = "Usage",
  Import = "Import",
  Include = "Include",

  // Specialized relationships
  PortBinding = "PortBinding",
  AdapterImplementation = "AdapterImplementation",
  UseCaseRealization = "UseCaseRealization"
}

/**
 * Defines whether edges are directed, undirected, or bidirectional
 */
export type EdgeDirectionality = 
  | "directed"    // Source → Target only
  | "undirected"  // Source ↔ Target (no inherent direction)
  | "bidirectional" // Source ↔ Target with semantic meaning in both directions

/**
 * Mapping of EdgeKind to directionality
 */
export const EDGE_DIRECTIONALITY: Record<EdgeKind, EdgeDirectionality> = {
  // Structural relationships
  [EdgeKind.Composition]: "directed",
  [EdgeKind.Aggregation]: "directed", 
  [EdgeKind.Dependency]: "directed",
  [EdgeKind.Inheritance]: "directed",
  [EdgeKind.Realization]: "directed",
  
  // Behavioral relationships
  [EdgeKind.Invocation]: "directed",
  [EdgeKind.Subscription]: "directed",
  [EdgeKind.Implementation]: "directed",
  
  // Dependency relationships
  [EdgeKind.Usage]: "directed",
  [EdgeKind.Import]: "directed",
  [EdgeKind.Include]: "directed",
  
  // Specialized relationships
  [EdgeKind.PortBinding]: "bidirectional",
  [EdgeKind.AdapterImplementation]: "directed",
  [EdgeKind.UseCaseRealization]: "directed"
};

/**
 * Type guard for EdgeKind
 * @param value - Value to check
 * @returns true if value is a valid EdgeKind
 */
export function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === "string" && 
    Object.values(EdgeKind).includes(value as EdgeKind);
}

/**
 * Gets the directionality for a given EdgeKind
 * @param kind - The EdgeKind to get directionality for
 * @returns The directionality of the edge kind
 */
export function getEdgeDirectionality(kind: EdgeKind): EdgeDirectionality {
  return EDGE_DIRECTIONALITY[kind];
}