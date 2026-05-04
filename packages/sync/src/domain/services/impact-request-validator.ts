import type { RefactoringType } from "./impact-analysis.types.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateRenameRequest(
  type: RefactoringType,
  newName: string | undefined,
): ValidationResult {
  if (!newName || newName.trim() === "") {
    return { valid: false, error: "New name is required for rename operations" };
  }

  if (type === "rename-port") {
    if (!newName.endsWith("Port")) {
      return { valid: false, error: "Port names must end with 'Port'" };
    }
    if (!/^[A-Z][a-zA-Z0-9]*Port$/.test(newName)) {
      return { valid: false, error: "Port names must be in PascalCase and end with 'Port'" };
    }
  }

  if (type === "rename-use-case") {
    if (!newName.endsWith("UseCase")) {
      return { valid: false, error: "Use case names must end with 'UseCase'" };
    }
    if (!/^[A-Z][a-zA-Z0-9]*UseCase$/.test(newName)) {
      return { valid: false, error: "Use case names must be in PascalCase and end with 'UseCase'" };
    }
  }

  if (type === "rename-entity") {
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(newName)) {
      return { valid: false, error: "Entity names must be in PascalCase" };
    }
  }

  return { valid: true };
}

export function validateMoveRequest(
  type: RefactoringType,
  newLocation: string | undefined,
): ValidationResult {
  if (type !== "move-use-case") {
    return { valid: true };
  }

  if (!newLocation || newLocation.trim() === "") {
    return { valid: false, error: "New location is required for move operations" };
  }

  return { valid: true };
}

export function validateRequest(
  request: { type: RefactoringType; target: string; newName?: string; newLocation?: string },
): ValidationResult {
  if (!request.target || request.target.trim() === "") {
    return { valid: false, error: "Target symbol is required" };
  }

  const renameResult = validateRenameRequest(request.type, request.newName);
  if (!renameResult.valid) {
    return renameResult;
  }

  const moveResult = validateMoveRequest(request.type, request.newLocation);
  if (!moveResult.valid) {
    return moveResult;
  }

  return { valid: true };
}