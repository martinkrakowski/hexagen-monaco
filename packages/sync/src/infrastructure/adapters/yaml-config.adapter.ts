// hexagen-monaco/packages/sync/src/infrastructure/adapters/yaml-config.adapter.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Result } from '@hexagen/sync/domain';
import type {
  OwnershipRegistryPort,
  PortOwnershipRecord,
  GeneratorConfigPort,
  InvariantConfig,
  BootstrapStep,
  InvariantPriority,
  FailureMode,
} from '@hexagen/sync';

const CONFIG_FILE = path.join(process.cwd(), '.architecture/generator.config.yaml');

/**
 * Helpers for runtime validation of enum values.
 */
function isInvariantPriority(v: unknown): v is InvariantPriority {
  return v === 'critical' || v === 'high' || v === 'medium';
}
function isFailureMode(v: unknown): v is FailureMode {
  return v === 'abort' || v === 'abort-and-cleanup' || v === 'warn-and-continue';
}

/**
 * Expected shape of the YAML file (raw, unvalidated).
 */
interface RawConfig {
  invariants?: unknown[];
  'bootstrap-sequence'?: unknown[];
  'failure-behavior'?: Record<string, unknown>;
  'ownership-registry'?: { ports: Record<string, unknown> };
}

/**
 * Internal cached representation – only the data we need.
 */
interface CachedConfig {
  invariants: InvariantConfig[];
  bootstrapSequence: BootstrapStep[];
  failureBehaviors: Record<InvariantPriority, FailureMode>;
  ownershipMap: PortOwnershipRecord[];
}

/**
 * Adapter that reads/writes the generator configuration YAML file.
 * Implements both the OwnershipRegistryPort and GeneratorConfigPort.
 */
export class YamlConfigAdapter implements OwnershipRegistryPort, GeneratorConfigPort {
  private cache: CachedConfig | null = null;
  private cacheMeta: { mtime: number; ino: number } | null = null;

  constructor(
    private readonly configFile = CONFIG_FILE,
    private readonly fsImpl = fs,
    private readonly logger = console,
  ) {}

  /** Convert internal CachedConfig → RawConfig for YAML serialization. */
  private toYamlDoc(config: CachedConfig): RawConfig {
    return {
      invariants: config.invariants,
      'bootstrap-sequence': config.bootstrapSequence,
      'failure-behavior': config.failureBehaviors,
      'ownership-registry': {
        ports: Object.fromEntries(
          config.ownershipMap.map((r) => [r.portName, r.owningPackage]),
        ),
      },
    };
  }

  /** Validate and convert a RawConfig → CachedConfig.
   * Throws on malformed input.
   */
  private fromYamlDoc(raw: RawConfig): CachedConfig {
    // ----- invariants ---------------------------------------------------------
    const invariants: InvariantConfig[] = [];
    if (raw.invariants) {
      if (!Array.isArray(raw.invariants)) {
        throw new Error('Invalid "invariants": must be an array');
      }
      for (const item of raw.invariants) {
        if (
          typeof item !== 'object' ||
          item === null ||
          typeof (item as Record<string, unknown>).name !== 'string' ||
          typeof (item as Record<string, unknown>).description !== 'string' ||
          !isInvariantPriority((item as Record<string, unknown>).priority) ||
          !isFailureMode((item as Record<string, unknown>).failure)
        ) {
          throw new Error(`Invalid invariant entry: ${JSON.stringify(item)}`);
        }
        invariants.push({
          name: (item as Record<string, unknown>).name as string,
          description: (item as Record<string, unknown>).description as string,
          priority: (item as Record<string, unknown>).priority as InvariantPriority,
          enforcement: (item as Record<string, unknown>).enforcement as
            | 'bootstrap'
            | 'generation-time'
            | undefined,
          failure: (item as Record<string, unknown>).failure as FailureMode,
        });
      }
    }

    // ----- bootstrap sequence -------------------------------------------------
    const bootstrapSequence: BootstrapStep[] = [];
    if (raw['bootstrap-sequence']) {
      if (!Array.isArray(raw['bootstrap-sequence'])) {
        throw new Error('Invalid "bootstrap-sequence": must be an array');
      }
      for (const item of raw['bootstrap-sequence']) {
        if (
          typeof item !== 'object' ||
          item === null ||
          typeof (item as Record<string, unknown>).name !== 'string' ||
          !isInvariantPriority((item as Record<string, unknown>).priority) ||
          !isFailureMode((item as Record<string, unknown>).failure)
        ) {
          throw new Error(`Invalid bootstrap step: ${JSON.stringify(item)}`);
        }
        bootstrapSequence.push({
          name: (item as Record<string, unknown>).name as string,
          priority: (item as Record<string, unknown>).priority as InvariantPriority,
          failure: (item as Record<string, unknown>).failure as FailureMode,
          note: (item as Record<string, unknown>).note as string | undefined,
        });
      }
    }

    // ----- failure behaviours -------------------------------------------------
    const defaultFailureBehaviors: Record<InvariantPriority, FailureMode> = {
      critical: 'abort-and-cleanup',
      high: 'abort',
      medium: 'warn-and-continue',
    };
    const failureBehaviors = { ...defaultFailureBehaviors };
    if (raw['failure-behavior']) {
      if (typeof raw['failure-behavior'] !== 'object' || raw['failure-behavior'] === null) {
        throw new Error('Invalid "failure-behavior": must be an object');
      }
      for (const [k, v] of Object.entries(raw['failure-behavior'])) {
        if (!isInvariantPriority(k) || !isFailureMode(v)) {
          throw new Error(`Invalid failure-behavior entry: ${k} -> ${JSON.stringify(v)}`);
        }
        failureBehaviors[k] = v as FailureMode;
      }
    }

    // ----- ownership registry -------------------------------------------------
    const ownershipMap: PortOwnershipRecord[] = [];
    if (raw['ownership-registry']?.ports) {
      const ports = raw['ownership-registry'].ports;
      if (typeof ports !== 'object' || ports === null) {
        throw new Error('Invalid "ownership-registry": ports must be an object');
      }
      for (const [portName, owningPackage] of Object.entries(ports)) {
        if (typeof portName !== 'string' || typeof owningPackage !== 'string') {
          throw new Error(`Invalid ownership entry: ${portName} -> ${JSON.stringify(owningPackage)}`);
        }
        ownershipMap.push({ portName, owningPackage });
      }
    }

    return {
      invariants,
      bootstrapSequence,
      failureBehaviors,
      ownershipMap,
    };
  }

  /**
   * Load the config from disk, using a cache that is invalidated on file change.
   */
  private async loadConfig(): Promise<CachedConfig> {
    const stat = await this.fsImpl.stat(this.configFile).catch(() => null);

    // Cache hit – file unchanged (mtime + ino)
    if (
      this.cache &&
      stat &&
      stat.mtimeMs === this.cacheMeta?.mtime &&
      stat.ino === this.cacheMeta?.ino
    ) {
      this.logger.debug('[YamlConfigAdapter] cache hit');
      return this.cache;
    }

    this.logger.debug('[YamlConfigAdapter] cache miss or file changed');

    let raw: RawConfig = {};

    try {
      const content = await this.fsImpl.readFile(this.configFile, 'utf8');
      raw = (yaml.load(content) as RawConfig) ?? {};

      const statAfterRead = await this.fsImpl.stat(this.configFile);
      this.cacheMeta = { mtime: statAfterRead.mtimeMs, ino: statAfterRead.ino };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug('[YamlConfigAdapter] config file missing → bootstrap empty');
        raw = {
          invariants: [],
          'bootstrap-sequence': [],
          'failure-behavior': {
            critical: 'abort-and-cleanup',
            high: 'abort',
            medium: 'warn-and-continue',
          },
          'ownership-registry': { ports: {} },
        };
      } else {
        throw err;
      }
    }

    const config = this.fromYamlDoc(raw);
    this.cache = config;
    return config;
  }

  /** Write a partial configuration back to disk atomically. */
  private async writeConfig(partial: Partial<CachedConfig>): Promise<void> {
    const current = await this.loadConfig();

    // Strip undefined values from the partial update.
    const sanitizedEntries = Object.entries(partial).filter(([, v]) => v !== undefined);
    const sanitized = Object.fromEntries(sanitizedEntries) as Partial<CachedConfig>;

    const updated = { ...current, ...sanitized };

    const yamlDoc = this.toYamlDoc(updated);
    const content = yaml.dump(yamlDoc, { indent: 2, lineWidth: -1 });

    await this.fsImpl.mkdir(path.dirname(this.configFile), { recursive: true });

    const tmpPath = `${this.configFile}.tmp`;
    await this.fsImpl.writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    await this.fsImpl.rename(tmpPath, this.configFile);

    const stat = await this.fsImpl.stat(this.configFile);
    this.cacheMeta = { mtime: stat.mtimeMs, ino: stat.ino };
    this.cache = updated;

    this.logger.debug('[YamlConfigAdapter] config written successfully');
  }

  // -------------------------------------------------------------------------
  // OwnershipRegistryPort implementation
  // -------------------------------------------------------------------------

  async loadOwnershipMap(): Promise<Result<PortOwnershipRecord[], Error>> {
    try {
      const { ownershipMap } = await this.loadConfig();
      return { success: true, value: [...ownershipMap] };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  async registerPortOwnership(
    portName: string,
    owningPackage: string,
  ): Promise<Result<void, Error>> {
    try {
      const { ownershipMap } = await this.loadConfig();
      const existing = ownershipMap.find((r) => r.portName === portName);

      if (existing) {
        if (existing.owningPackage !== owningPackage) {
          return {
            success: false,
            error: new Error(`Port ${portName} already owned by ${existing.owningPackage}`),
          };
        }
        return { success: true, value: undefined };
      }

      const updatedMap = [...ownershipMap, { portName, owningPackage }];
      await this.writeConfig({ ownershipMap: updatedMap });
      return { success: true, value: undefined };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  async canDeclarePort(portName: string, contextName: string): Promise<boolean> {
    try {
      const { ownershipMap } = await this.loadConfig();
      const existing = ownershipMap.find((r) => r.portName === portName);
      return !existing || existing.owningPackage === contextName;
    } catch {
      return false; // fail‑safe: assume conflict
    }
  }

  async getOwningPackage(portName: string): Promise<string | null> {
    try {
      const { ownershipMap } = await this.loadConfig();
      return ownershipMap.find((r) => r.portName === portName)?.owningPackage ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // GeneratorConfigPort implementation
  // -------------------------------------------------------------------------

  async getBootstrapSequence(): Promise<Result<BootstrapStep[], Error>> {
    try {
      const { bootstrapSequence } = await this.loadConfig();
      return { success: true, value: bootstrapSequence };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  async getFailureBehavior(priority: InvariantPriority): Promise<FailureMode> {
    try {
      const { failureBehaviors } = await this.loadConfig();
      return failureBehaviors[priority] ?? 'warn-and-continue';
    } catch {
      return 'warn-and-continue'; // fail‑safe
    }
  }

  async getInvariantPriority(invariantName: string): Promise<InvariantPriority | null> {
    try {
      const { invariants } = await this.loadConfig();
      return invariants.find((i) => i.name === invariantName)?.priority ?? null;
    } catch {
      return null;
    }
  }

  async getAllInvariants(): Promise<Result<InvariantConfig[], Error>> {
    try {
      const { invariants } = await this.loadConfig();
      return { success: true, value: invariants };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  // -------------------------------------------------------------------------
  // Testing helpers
  // -------------------------------------------------------------------------

  resetCache(): void {
    this.cache = null;
    this.cacheMeta = null;
  }
}
