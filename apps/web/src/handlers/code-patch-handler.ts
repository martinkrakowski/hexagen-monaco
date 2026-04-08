import type { Result } from "@hexagen/shared";

export type CodePatchType =
  | "ADD_FILE"
  | "REMOVE_FILE"
  | "MODIFY_FILE"
  | "UPDATE_MANIFEST";

export interface CodePatchIntent {
  type: CodePatchType;
  payload: {
    filePath?: string;
    content?: string;
    manifestPatch?: string;
  };
}

export interface CodePatchResult {
  applied: boolean;
  description: string;
  affectedFiles: string[];
  revertAction?: CodePatchIntent;
}

export type CodePatchHandler = (
  intent: CodePatchIntent,
) => Promise<Result<CodePatchResult>>;

export function createCodePatchHandler(
  applyPatch: (intent: CodePatchIntent) => Promise<Result<CodePatchResult>>,
): CodePatchHandler {
  return async (intent: CodePatchIntent): Promise<Result<CodePatchResult>> => {
    return applyPatch(intent);
  };
}

export function describePatch(intent: CodePatchIntent): string {
  switch (intent.type) {
    case "ADD_FILE":
      return `Add file "${intent.payload.filePath}"`;
    case "REMOVE_FILE":
      return `Remove file "${intent.payload.filePath}"`;
    case "MODIFY_FILE":
      return `Modify file "${intent.payload.filePath}"`;
    case "UPDATE_MANIFEST":
      return `Update manifest.yaml`;
    default:
      return `Apply ${intent.type} code patch`;
  }
}

export function validatePatchIntent(
  intent: CodePatchIntent,
): Result<CodePatchIntent> {
  if (!intent.type) {
    return { success: false, error: new Error("Patch type is required") };
  }

  if (intent.type === "ADD_FILE" || intent.type === "MODIFY_FILE") {
    if (!intent.payload.filePath) {
      return { success: false, error: new Error("File path is required") };
    }
  }

  if (intent.type === "UPDATE_MANIFEST") {
    if (!intent.payload.manifestPatch) {
      return { success: false, error: new Error("Manifest patch is required") };
    }
  }

  return { success: true, value: intent };
}
