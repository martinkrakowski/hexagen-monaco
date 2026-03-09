import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Result } from '@hexagen/shared';
import type {
  OwnershipRegistryPort,
  PortOwnershipRecord,
  GeneratorConfigPort,
  InvariantConfig,
  BootstrapStep,
  InvariantPriority,
  FailureMode,
} from '@hexagen/sync';

const CONFIG_FILE = path.join(
  process.cwd(),
  '.architecture/generator.config.yaml'
);

interface RawConfig {
  invariants?: InvariantConfig[];
  'bootstrap-sequence'?: BootstrapStep[];
  'failure-behavior'?: Record<InvariantPriority, FailureMode>;
  'ownership-registry'?: { ports: Record<string, string> };
}

interface CachedConfig {
  invariants: InvariantConfig[];
  bootstrapSequence: BootstrapStep[];
  failureBehaviors: Record<InvariantPriority, FailureMode>;
  ownershipMap: PortOwnershipRecord[];
  lastModified: number;
  lastIno: number;
}

export class YamlConfigAdapter
  implements OwnershipRegistryPort, GeneratorConfigPort
{
  private cache: CachedConfig | null = null;
  private cacheMeta: { mtime: number; ino: number } | null = null;

  constructor(
    private readonly configFile = CONFIG_FILE,
    private readonly fsImpl = fs,
    private readonly logger = console
  ) {}

  private toYamlDoc(config: CachedConfig): RawConfig {
    return {
      invariants: config.invariants,
      'bootstrap-sequence': config.bootstrapSequence,
      'failure-behavior': config.failureBehaviors,
      'ownership-registry': {
        ports: Object.fromEntries(
          config.ownershipMap.map((r) => [r.portName, r.owningPackage])
        ),
      },
    };
  }

  private fromYamlDoc(raw: RawConfig): CachedConfig {
    const defaultFailureBehaviors: Record<InvariantPriority, FailureMode> = {
      critical: 'abort-and-cleanup',
      high: 'abort',
      medium: 'warn-and-continue',
    };

    return {
      invariants: raw.invariants ?? [],
      bootstrapSequence: raw['bootstrap-sequence'] ?? [],
      failureBehaviors: raw['failure-behavior'] ?? defaultFailureBehaviors,
      ownershipMap: Object.entries(raw['ownership-registry']?.ports ?? {}).map(
        ([portName, owningPackage]) => ({ portName, owningPackage })
      ),
      lastModified: 0,
      lastIno: 0,
    };
  }

  private async loadConfig(): Promise<CachedConfig> {
    const stat = await this.fsImpl.stat(this.configFile).catch(() => null);

    // Cache hit: file unchanged (mtime + ino check)
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
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.logger.debug(
          '[YamlConfigAdapter] config file missing → bootstrap empty'
        );
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
    config.lastModified = this.cacheMeta?.mtime ?? Date.now();
    config.lastIno = this.cacheMeta?.ino ?? 0;

    this.cache = config;

    return config;
  }

  private async writeConfig(partial: Partial<CachedConfig>): Promise<void> {
    const current = await this.loadConfig();
    const updated = { ...current, ...partial };

    const yamlDoc = this.toYamlDoc(updated);
    const content = yaml.dump(yamlDoc, { indent: 2, lineWidth: -1 });

    await this.fsImpl.mkdir(path.dirname(this.configFile), { recursive: true });

    const tmpPath = this.configFile + '.tmp';
    await this.fsImpl.writeFile(tmpPath, content, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await this.fsImpl.rename(tmpPath, this.configFile);

    const stat = await this.fsImpl.stat(this.configFile);
    this.cacheMeta = { mtime: stat.mtimeMs, ino: stat.ino };
    this.cache = updated;

    this.logger.debug('[YamlConfigAdapter] config written successfully');
  }

  // OwnershipRegistryPort
  async loadOwnershipMap(): Promise<Result<PortOwnershipRecord[], Error>> {
    try {
      const { ownershipMap } = await this.loadConfig();
      return { success: true, value: ownershipMap };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  async registerPortOwnership(
    portName: string,
    owningPackage: string
  ): Promise<Result<void, Error>> {
    try {
      const { ownershipMap } = await this.loadConfig();
      const existing = ownershipMap.find((r) => r.portName === portName);

      if (existing) {
        if (existing.owningPackage !== owningPackage) {
          return {
            success: false,
            error: new Error(
              `Port ${portName} already owned by ${existing.owningPackage}`
            ),
          };
        }
        return { success: true, value: void 0 };
      }

      const updatedMap = [...ownershipMap, { portName, owningPackage }];
      await this.writeConfig({ ownershipMap: updatedMap });
      return { success: true, value: void 0 };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  async canDeclarePort(
    portName: string,
    contextName: string
  ): Promise<boolean> {
    try {
      const { ownershipMap } = await this.loadConfig();
      const existing = ownershipMap.find((r) => r.portName === portName);
      return !existing || existing.owningPackage === contextName;
    } catch {
      return false; // fail-safe: assume conflict
    }
  }

  async getOwningPackage(portName: string): Promise<string | null> {
    try {
      const { ownershipMap } = await this.loadConfig();
      return (
        ownershipMap.find((r) => r.portName === portName)?.owningPackage ?? null
      );
    } catch {
      return null;
    }
  }

  // GeneratorConfigPort
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
      return 'warn-and-continue'; // fail-safe
    }
  }

  async getInvariantPriority(
    invariantName: string
  ): Promise<InvariantPriority | null> {
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

  //Testing hooks
  resetCache(): void {
    this.cache = null;
    this.cacheMeta = null;
  }
}
