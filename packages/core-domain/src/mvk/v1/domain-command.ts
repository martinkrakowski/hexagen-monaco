/**
 * DomainCommand discriminated union - MVK v1
 *
 * This file is part of the batched emission of MVK v1 TypeScript scaffold.
 * See mvk-compilation-pass: cp-2026-04-22-01
 *
 * Per ADR 0018 Q10/Q11: DomainCommand variants carry only type + payload.
 * Intent lineage is tracked by IntentLineage, not by command-level fields.
 */

import { Identifier } from "./domain-ast.js";
import { NodeKind } from "./node-kind.js";
import { EdgeKind } from "./edge-kind.js";

export interface CreateNodeCommand {
  type: "CreateNode";
  payload: {
    kind: NodeKind;
    attributes: Record<string, unknown>;
  };
}

export interface UpdateNodeCommand {
  type: "UpdateNode";
  payload: {
    nodeId: Identifier;
    attributes: Partial<Record<string, unknown>>;
  };
}

export interface DeleteNodeCommand {
  type: "DeleteNode";
  payload: {
    nodeId: Identifier;
  };
}

export interface CreateEdgeCommand {
  type: "CreateEdge";
  payload: {
    kind: EdgeKind;
    source: Identifier;
    target: Identifier;
    attributes: Record<string, unknown>;
  };
}

export interface UpdateEdgeCommand {
  type: "UpdateEdge";
  payload: {
    edgeId: Identifier;
    attributes: Partial<Record<string, unknown>>;
  };
}

export interface DeleteEdgeCommand {
  type: "DeleteEdge";
  payload: {
    edgeId: Identifier;
  };
}

export interface BatchCommand {
  type: "Batch";
  payload: {
    commands: DomainCommand[];
  };
}

export type DomainCommand =
  | CreateNodeCommand
  | UpdateNodeCommand
  | DeleteNodeCommand
  | CreateEdgeCommand
  | UpdateEdgeCommand
  | DeleteEdgeCommand
  | BatchCommand;

export function isCreateNodeCommand(
  command: DomainCommand,
): command is CreateNodeCommand {
  return command.type === "CreateNode";
}

export function isUpdateNodeCommand(
  command: DomainCommand,
): command is UpdateNodeCommand {
  return command.type === "UpdateNode";
}

export function isDeleteNodeCommand(
  command: DomainCommand,
): command is DeleteNodeCommand {
  return command.type === "DeleteNode";
}

export function isCreateEdgeCommand(
  command: DomainCommand,
): command is CreateEdgeCommand {
  return command.type === "CreateEdge";
}

export function isUpdateEdgeCommand(
  command: DomainCommand,
): command is UpdateEdgeCommand {
  return command.type === "UpdateEdge";
}

export function isDeleteEdgeCommand(
  command: DomainCommand,
): command is DeleteEdgeCommand {
  return command.type === "DeleteEdge";
}

export function isBatchCommand(
  command: DomainCommand,
): command is BatchCommand {
  return command.type === "Batch";
}
