import type { Result } from "@hexagen/shared";
import type {
  FormMutationIntent,
  FormMutationResult,
} from "./form-mutation-handler";
import type { CodePatchIntent, CodePatchResult } from "./code-patch-handler";
import type {
  CanvasMutationIntent,
  CanvasMutationResult,
} from "./canvas-update-handler";

export type IntentType = "FORM_MUTATION" | "CODE_PATCH" | "CANVAS_MUTATION";

export interface UnifiedIntent {
  type: IntentType;
  payload: FormMutationIntent | CodePatchIntent | CanvasMutationIntent;
  correlationId: string;
  timestamp: number;
}

export interface IntentRouterDeps {
  formHandler: (
    intent: FormMutationIntent,
  ) => Promise<Result<FormMutationResult>>;
  codePatchHandler: (
    intent: CodePatchIntent,
  ) => Promise<Result<CodePatchResult>>;
  canvasHandler: (
    intent: CanvasMutationIntent,
  ) => Promise<Result<CanvasMutationResult>>;
}

export type IntentRouter = (intent: UnifiedIntent) => Promise<Result<unknown>>;

export function createIntentRouter(deps: IntentRouterDeps): IntentRouter {
  return async (intent: UnifiedIntent): Promise<Result<unknown>> => {
    switch (intent.type) {
      case "FORM_MUTATION":
        return await deps.formHandler(intent.payload as FormMutationIntent);
      case "CODE_PATCH":
        return await deps.codePatchHandler(intent.payload as CodePatchIntent);
      case "CANVAS_MUTATION":
        return await deps.canvasHandler(intent.payload as CanvasMutationIntent);
      default:
        return {
          success: false,
          error: new Error(`Unknown intent type: ${intent.type}`),
        };
    }
  };
}

export function createUnifiedIntent(
  type: IntentType,
  payload: FormMutationIntent | CodePatchIntent | CanvasMutationIntent,
): UnifiedIntent {
  return {
    type,
    payload,
    correlationId: crypto.randomUUID(),
    timestamp: Date.now(),
  };
}
