import type { Result } from "@hexagen/shared";

export type FormMutationType =
  | "ADD_CONTEXT"
  | "REMOVE_CONTEXT"
  | "UPDATE_CONTEXT"
  | "ADD_PORT"
  | "REMOVE_PORT"
  | "ADD_PEER_MAPPING"
  | "UPDATE_WORKSPACE";

export interface FormMutationIntent {
  type: FormMutationType;
  payload: Record<string, unknown>;
}

export interface FormMutationResult {
  applied: boolean;
  description: string;
  revertAction?: FormMutationIntent;
}

export type FormMutationHandler = (
  intent: FormMutationIntent,
) => Promise<Result<FormMutationResult>>;

export function createFormMutationHandler(
  applyMutation: (
    intent: FormMutationIntent,
  ) => Promise<Result<FormMutationResult>>,
): FormMutationHandler {
  return async (
    intent: FormMutationIntent,
  ): Promise<Result<FormMutationResult>> => {
    return applyMutation(intent);
  };
}

export function describeMutation(intent: FormMutationIntent): string {
  switch (intent.type) {
    case "ADD_CONTEXT":
      return `Add bounded context "${intent.payload.name}"`;
    case "REMOVE_CONTEXT":
      return `Remove bounded context "${intent.payload.contextId}"`;
    case "UPDATE_CONTEXT":
      return `Update context "${intent.payload.contextId}"`;
    case "ADD_PORT":
      return `Add port to context "${intent.payload.contextId}"`;
    case "REMOVE_PORT":
      return `Remove port "${intent.payload.portId}" from context "${intent.payload.contextId}"`;
    case "ADD_PEER_MAPPING":
      return `Add peer mapping between contexts`;
    case "UPDATE_WORKSPACE":
      return `Update workspace settings`;
    default:
      return `Apply ${intent.type} mutation`;
  }
}
