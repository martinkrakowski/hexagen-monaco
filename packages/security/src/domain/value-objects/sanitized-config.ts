export interface SanitizedConfig {
  _tag: "SanitizedConfig";
  originalLength: number;
  redactedCount: number;
  redactedKeys: string[];
  scanTimestamp: Date;
  isClean: boolean;
}

export interface SecretLeakError {
  _tag: "SecretLeakError";
  redactedKeys: string[];
  scanTimestamp: Date;
}

export function createCleanConfig(rawConfig: string): SanitizedConfig {
  return {
    _tag: "SanitizedConfig",
    originalLength: rawConfig.length,
    redactedCount: 0,
    redactedKeys: [],
    scanTimestamp: new Date(),
    isClean: true,
  };
}

export function createDirtyConfig(
  rawConfig: string,
  redactedKeys: string[],
): SanitizedConfig {
  return {
    _tag: "SanitizedConfig",
    originalLength: rawConfig.length,
    redactedCount: redactedKeys.length,
    redactedKeys,
    scanTimestamp: new Date(),
    isClean: false,
  };
}
