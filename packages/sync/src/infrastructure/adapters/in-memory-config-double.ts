import type {
  OwnershipRegistryPort,
  PortOwnershipRecord,
  GeneratorConfigPort,
  InvariantConfig,
  BootstrapStep,
  InvariantPriority,
  FailureMode,
} from '@hexagen/sync';
import type { Result } from '@hexagen/shared';

export class InMemoryConfigDouble
  implements OwnershipRegistryPort, GeneratorConfigPort
{
  private invariants: InvariantConfig[] = [];
  private bootstrapSequence: BootstrapStep[] = [];
  private failureBehaviors: Record<InvariantPriority, FailureMode> = {
    critical: 'abort-and-cleanup',
    high: 'abort',
    medium: 'warn-and-continue',
  };
  private ownershipMap: PortOwnershipRecord[] = [];

  constructor(initial?: {
    invariants?: InvariantConfig[];
    bootstrapSequence?: BootstrapStep[];
    failureBehaviors?: Partial<Record<InvariantPriority, FailureMode>>;
    ownershipMap?: PortOwnershipRecord[];
  }) {
    if (initial) {
      this.invariants = initial.invariants ?? [];
      this.bootstrapSequence = initial.bootstrapSequence ?? [];
      this.failureBehaviors = {
        ...this.failureBehaviors,
        ...initial.failureBehaviors,
      };
      this.ownershipMap = initial.ownershipMap ?? [];
    }
  }

  // OwnershipRegistryPort
  async loadOwnershipMap(): Promise<Result<PortOwnershipRecord[], Error>> {
    return { success: true, value: [...this.ownershipMap] };
  }

  async registerPortOwnership(
    portName: string,
    owningPackage: string
  ): Promise<Result<void, Error>> {
    const existing = this.ownershipMap.find((r) => r.portName === portName);

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

    this.ownershipMap.push({ portName, owningPackage });
    return { success: true, value: void 0 };
  }

  async canDeclarePort(
    portName: string,
    contextName: string
  ): Promise<boolean> {
    const existing = this.ownershipMap.find((r) => r.portName === portName);
    return !existing || existing.owningPackage === contextName;
  }

  async getOwningPackage(portName: string): Promise<string | null> {
    return (
      this.ownershipMap.find((r) => r.portName === portName)?.owningPackage ??
      null
    );
  }

  // GeneratorConfigPort
  async getBootstrapSequence(): Promise<Result<BootstrapStep[], Error>> {
    return { success: true, value: [...this.bootstrapSequence] };
  }

  async getFailureBehavior(priority: InvariantPriority): Promise<FailureMode> {
    return this.failureBehaviors[priority] ?? 'warn-and-continue';
  }

  async getInvariantPriority(
    invariantName: string
  ): Promise<InvariantPriority | null> {
    return (
      this.invariants.find((i) => i.name === invariantName)?.priority ?? null
    );
  }

  async getAllInvariants(): Promise<Result<InvariantConfig[], Error>> {
    return { success: true, value: [...this.invariants] };
  }

  // Test helpers
  setInvariants(invariants: InvariantConfig[]): void {
    this.invariants = invariants;
  }

  setBootstrapSequence(steps: BootstrapStep[]): void {
    this.bootstrapSequence = steps;
  }

  setFailureBehavior(priority: InvariantPriority, mode: FailureMode): void {
    this.failureBehaviors[priority] = mode;
  }

  setOwnershipMap(map: PortOwnershipRecord[]): void {
    this.ownershipMap = map;
  }

  clear(): void {
    this.invariants = [];
    this.bootstrapSequence = [];
    this.failureBehaviors = {
      critical: 'abort-and-cleanup',
      high: 'abort',
      medium: 'warn-and-continue',
    };
    this.ownershipMap = [];
  }
}
