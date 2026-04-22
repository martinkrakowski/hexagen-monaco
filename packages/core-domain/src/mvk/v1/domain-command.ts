/**
 * DomainCommand discriminated union - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-20-01
 */

import { Identifier } from "./domain-ast.js";
import { NodeKind } from "./node-kind.js";
import { EdgeKind } from "./edge-kind.js";

/**
 * Base interface for all DomainCommands
 */
interface BaseDomainCommand {
  /** Unique identifier for tracking command execution lineage */
  readonly lineageId: Identifier;
  /** Timestamp when the command was created */
  readonly timestamp: number;
}

/**
 * CreateNode command - adds a new node to the DomainAST
 */
export interface CreateNodeCommand extends BaseDomainCommand {
  type: "CreateNode";
  payload: {
    /** The kind of node to create */
    kind: NodeKind;
    /** Initial attributes for the node */
    attributes: Record<string, unknown>;
  };
}

/**
 * UpdateNode command - modifies attributes of an existing node
 */
export interface UpdateNodeCommand extends BaseDomainCommand {
  type: "UpdateNode";
  payload: {
    /** The ID of the node to update */
    nodeId: Identifier;
    /** Partial attributes to update (only specified fields will be changed) */
    attributes: Partial<Record<string, unknown>>;
  };
}

/**
 * DeleteNode command - removes a node from the DomainAST
 */
export interface DeleteNodeCommand extends BaseDomainCommand {
  type: "DeleteNode";
  payload: {
    /** The ID of the node to delete */
    nodeId: Identifier;
  };
}

/**
 * CreateEdge command - adds a new edge to the DomainAST
 */
export interface CreateEdgeCommand extends BaseDomainCommand {
  type: "CreateEdge";
  payload: {
    /** The kind of edge to create */
    kind: EdgeKind;
    /** The ID of the source node */
    source: Identifier;
    /** The ID of the target node */
    target: Identifier;
    /** Initial attributes for the edge */
    attributes: Record<string, unknown>;
  };
}

/**
 * UpdateEdge command - modifies attributes of an existing edge
 */
export interface UpdateEdgeCommand extends BaseDomainCommand {
  type: "UpdateEdge";
  payload: {
    /** The ID of the edge to update */
    edgeId: Identifier;
    /** Partial attributes to update (only specified fields will be changed) */
    attributes: Partial<Record<string, unknown>>;
  };
}

/**
 * DeleteEdge command - removes an edge from the DomainAST
 */
export interface DeleteEdgeCommand extends BaseDomainCommand {
  type: "DeleteEdge";
  payload: {
    /** The ID of the edge to delete */
    edgeId: Identifier;
  };
}

/**
 * Batch command - groups multiple commands for atomic execution
 */
export interface BatchCommand extends BaseDomainCommand {
  type: "Batch";
  payload: {
    /** The commands to execute as a single unit */
    commands: DomainCommand[];
  };
}

/**
 * Union type of all possible DomainCommands
 */
export type DomainCommand =
  | CreateNodeCommand
  | UpdateNodeCommand
  | DeleteNodeCommand
  | CreateEdgeCommand
  | UpdateEdgeCommand
  | DeleteEdgeCommand
  | BatchCommand;

/**
 * Type guard for CreateNodeCommand
 * @param command - Command to check
 * @returns true if command is a CreateNodeCommand
 */
export function isCreateNodeCommand(
  command: DomainCommand,
): command is CreateNodeCommand {
  return command.type === "CreateNode";
}

/**
 * Type guard for UpdateNodeCommand
 * @param command - Command to check
 * @returns true if command is an UpdateNodeCommand
 */
export function isUpdateNodeCommand(
  command: DomainCommand,
): command is UpdateNodeCommand {
  return command.type === "UpdateNode";
}

/**
 * Type guard for DeleteNodeCommand
 * @param command - Command to check
 * @returns true if command is a DeleteNodeCommand
 */
export function isDeleteNodeCommand(
  command: DomainCommand,
): command is DeleteNodeCommand {
  return command.type === "DeleteNode";
}

/**
 * Type guard for CreateEdgeCommand
 * @param command - Command to check
 * @returns true if command is a CreateEdgeCommand
 */
export function isCreateEdgeCommand(
  command: DomainCommand,
): command is CreateEdgeCommand {
  return command.type === "CreateEdge";
}

/**
 * Type guard for UpdateEdgeCommand
 * @param command - Command to check
 * @returns true if command is an UpdateEdgeCommand
 */
export function isUpdateEdgeCommand(
  command: DomainCommand,
): command is UpdateEdgeCommand {
  return command.type === "UpdateEdge";
}

/**
 * Type guard for DeleteEdgeCommand
 * @param command - Command to check
 * @returns true if command is a DeleteEdgeCommand
 */
export function isDeleteEdgeCommand(
  command: DomainCommand,
): command is DeleteEdgeCommand {
  return command.type === "DeleteEdge";
}

/**
 * Type guard for BatchCommand
 * @param command - Command to check
 * @returns true if command is a BatchCommand
 */
export function isBatchCommand(
  command: DomainCommand,
): command is BatchCommand {
  return command.type === "Batch";
}
