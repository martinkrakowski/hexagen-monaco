import { ManifestSchema } from "@hexagen/shared";

export interface ValidateManifestChangeResult {
  valid: boolean;
  errors: string[];
}

export class ValidateManifestChangeUseCase {
  execute(proposedManifest: unknown): ValidateManifestChangeResult {
    const validationResult = ManifestSchema.safeParse(proposedManifest);
    if (!validationResult.success) {
      return {
        valid: false,
        errors: validationResult.error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root";
          return `${path}: ${issue.message}`;
        }),
      };
    }

    return { valid: true, errors: [] };
  }
}
