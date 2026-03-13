import type { Result } from "@hexagen/sync";
import type { OwnershipRegistryPort, PortOwnershipRecord } from "@hexagen/sync";

/**
 * In‑memory fake for `OwnershipRegistryPort`.
 *
 * Allows tests to set up an ownership map and to customise the
 * behaviour of the `registerPortOwnership` method.
 *
 * The default implementation behaves like the real registry:
 *   - `loadOwnershipMap` returns the current map (empty by default).
 *   - `registerPortOwnership` adds a new record if the port is not yet
 *     owned, otherwise it fails with an `Error` when the
 *     owning package differs.
 *   - `canDeclarePort` checks for conflicts against the stored map.
 *   - `getOwningPackage` returns the owner or `null` if unregistered.
 */
export class FakeOwnershipRegistryPort implements OwnershipRegistryPort {
  /** Internal storage for port ownership records. */
  private ownershipMap: PortOwnershipRecord[] = [];

  /** Optional error to be returned by `registerPortOwnership`. */
  private registerError: Error | null = null;

  /** Set a custom error for `registerPortOwnership`. */
  setRegisterError(err: Error | null) {
    this.registerError = err;
  }

  /** Replace the whole in‑memory map (useful for test setup). */
  setOwnershipMap(map: PortOwnershipRecord[]) {
    this.ownershipMap = map;
  }

  async loadOwnershipMap(): Promise<Result<PortOwnershipRecord[], Error>> {
    return { success: true, value: [...this.ownershipMap] };
  }

  async registerPortOwnership(
    portName: string,
    owningPackage: string,
  ): Promise<Result<void, Error>> {
    // Simulate a forced error if the test requested it.
    if (this.registerError) {
      return { success: false, error: this.registerError };
    }

    const existing = this.ownershipMap.find((r) => r.portName === portName);
    if (!existing) {
      // New port – add to the map.
      this.ownershipMap.push({ portName, owningPackage });
      return { success: true, value: undefined };
    }

    if (existing.owningPackage === owningPackage) {
      // Idempotent operation – already owned by the same package.
      return { success: true, value: undefined };
    }

    // Conflict – another package already owns this port.
    return {
      success: false,
      error: new Error(
        `Port "${portName}" already owned by "${existing.owningPackage}"`,
      ),
    };
  }

  async canDeclarePort(
    portName: string,
    contextName: string,
  ): Promise<boolean> {
    const existing = this.ownershipMap.find((r) => r.portName === portName);
    // If not registered or owned by the same context, declaration is allowed.
    return !existing || existing.owningPackage === contextName;
  }

  async getOwningPackage(portName: string): Promise<string | null> {
    const record = this.ownershipMap.find((r) => r.portName === portName);
    return record ? record.owningPackage : null;
  }
}
