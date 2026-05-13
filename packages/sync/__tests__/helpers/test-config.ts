import type { SyncFlags, SyncConfig, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";
import { createSpyLogger, silentLogger, type SpyLogger } from "./spy-logger.js";

export interface FlagOverrides {
  dryRun?: boolean;
  logger?: LoggerPort;
}

export function makeExternalDryRunFlags(
  overrides: FlagOverrides = {},
): SyncFlags {
  return {
    dryRun: overrides.dryRun ?? true,
    force: false,
    forceRoot: false,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: overrides.logger ?? createSpyLogger(),
  };
}

export interface SelfRegenFlagOverrides {
  dryRun?: boolean;
  allowDirty?: boolean;
  logger?: LoggerPort;
}

export function makeSelfRegenFlags(
  overrides: SelfRegenFlagOverrides = {},
): SyncFlags {
  return {
    dryRun: overrides.dryRun ?? false,
    force: false,
    forceRoot: false,
    allowDirty: overrides.allowDirty ?? false,
    strict: false,
    mode: "self-regen",
    logger: overrides.logger ?? createSpyLogger(),
  };
}

export function makeFlags(): SyncFlags {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: silentLogger,
  };
}

export function makeForceRootFlags(): SyncFlags {
  return {
    dryRun: false,
    force: true,
    forceRoot: true,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: silentLogger,
  };
}

export interface GeneratorConfigOverrides {
  mode?: "self-regen" | "external";
  dryRun?: boolean;
  force?: boolean;
  forceRoot?: boolean;
  logger?: LoggerPort;
  manifest?: Manifest;
  enableApps?: boolean;
}

export function makeConfig(
  workspaceRoot: string,
  manifestOrOverrides?: Manifest | GeneratorConfigOverrides,
  overrides: GeneratorConfigOverrides = {},
): SyncConfig {
  let manifest: Manifest;
  let opts: GeneratorConfigOverrides;

  if (
    manifestOrOverrides &&
    ("bounded_contexts" in manifestOrOverrides ||
      "generator" in manifestOrOverrides ||
      "system" in manifestOrOverrides ||
      "scope" in manifestOrOverrides ||
      "apps" in manifestOrOverrides)
  ) {
    manifest = manifestOrOverrides as Manifest;
    opts = overrides;
  } else if (manifestOrOverrides) {
    manifest = (manifestOrOverrides as GeneratorConfigOverrides).manifest ?? {
      description: "Test manifest",
      bounded_contexts: [],
    };
    opts = manifestOrOverrides as GeneratorConfigOverrides;
  } else {
    manifest = { description: "Test manifest", bounded_contexts: [] };
    opts = overrides;
  }

  if (opts.enableApps) {
    manifest = {
      ...manifest,
      generator: {
        ...manifest.generator,
        sync: {
          ...manifest.generator?.sync,
          apps: {
            ...manifest.generator?.sync?.apps,
            enabled: true,
          },
        },
      },
    };
  }

  const mode = opts.mode ?? "external";

  return {
    dryRun: opts.dryRun ?? false,
    force: opts.force ?? false,
    forceRoot: opts.forceRoot ?? false,
    allowDirty: false,
    strict: false,
    mode,
    logger: opts.logger ?? silentLogger,
    manifest,
    workspaceRoot,
  };
}

export interface RecordedOp {
  type: string;
  target: string;
  message: string | undefined;
}

export function makeReport(): {
  record: (type: string, target: string, message?: string) => void;
  calls: RecordedOp[];
} {
  const calls: RecordedOp[] = [];
  return {
    calls,
    record: (type, target, message) => {
      calls.push({ type, target, message });
    },
  };
}

export function makeReportSpy(): {
  report: { record: (type: string, target: string, message?: string) => void };
  calls: RecordedOp[];
} {
  const calls: RecordedOp[] = [];
  return {
    report: {
      record: (type, target, message) => {
        calls.push({ type, target, message });
      },
    },
    calls,
  };
}

export { createSpyLogger, silentLogger, type SpyLogger };
