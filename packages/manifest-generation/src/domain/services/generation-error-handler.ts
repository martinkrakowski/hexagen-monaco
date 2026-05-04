export type ErrorClassificationCode =
  | "yaml_validation_failed"
  | "no_yaml_extracted"
  | "inference_failed"
  | "unknown";

export interface ClassifiedError {
  code: ErrorClassificationCode;
  message: string;
}

export function classifyGenerationError(error: string): ClassifiedError {
  if (error.startsWith("Generated manifest has invalid YAML:")) {
    return {
      code: "yaml_validation_failed",
      message:
        "The AI produced malformed YAML. Please try again with a shorter description, or click Retry.",
    };
  }

  if (error.includes("did not contain a valid manifest")) {
    return {
      code: "no_yaml_extracted",
      message: error,
    };
  }

  return {
    code: "inference_failed",
    message: error,
  };
}