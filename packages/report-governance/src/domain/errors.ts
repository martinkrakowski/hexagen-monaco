export class FeatureReportNotFoundError extends Error {
  constructor(featureId: string) {
    super(`Feature report not found: ${featureId}`);
    this.name = "FeatureReportNotFoundError";
  }
}

export class InvalidPhaseTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid phase transition from '${from}' to '${to}'`);
    this.name = "InvalidPhaseTransitionError";
  }
}

export class ReportPersistenceError extends Error {
  constructor(operation: string, path: string, cause: Error) {
    super(
      `Report persistence failed during '${operation}' on path '${path}': ${cause.message}`,
    );
    this.name = "ReportPersistenceError";
    this.cause = cause;
  }
}

export class FeatureIdValidationError extends Error {
  constructor(raw: string) {
    super(`Invalid FeatureId: '${raw}'`);
    this.name = "FeatureIdValidationError";
  }
}
