import type { Result } from '@hexagen/shared';

export interface PortOwnershipRecord {
  portName: string;
  owningPackage: string;
}

export interface OwnershipRegistryPort {
  /**
   * Loads the current ownership map from persistent storage.
   * Returns empty map if file doesn't exist (bootstrap case).
   */
  loadOwnershipMap(): Promise<Result<PortOwnershipRecord[], Error>>;

  /**
   * Registers a new port → package ownership.
   * Fails if port already exists with different owner.
   */
  registerPortOwnership(
    portName: string,
    owningPackage: string
  ): Promise<Result<void, Error>>;

  /**
   * Checks if a port can be declared in the given context.
   * Returns true if new or same owner, false if conflict.
   */
  canDeclarePort(portName: string, contextName: string): Promise<boolean>;

  /**
   * Gets the owning package for a port.
   * Returns null if not registered.
   */
  getOwningPackage(portName: string): Promise<string | null>;
}
