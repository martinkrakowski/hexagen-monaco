export const MAX_RETRY_ATTEMPTS = 3;

export class StageMaxRetriesError extends Error {
  constructor(
    public readonly stage: number,
    public readonly lastParseError: string,
    public readonly lastRawOutput: string,
  ) {
    super(
      `Stage ${stage} failed after ${MAX_RETRY_ATTEMPTS} attempts. ` +
        `Last error: ${lastParseError}`,
    );
    this.name = "StageMaxRetriesError";
  }
}
