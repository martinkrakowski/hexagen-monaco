import * as path from "node:path";

/**
 * Positive enforcement of the `required_communication` invariant (Phase 3c).
 *
 * Phase 1 emits `cross_context: { deny_direct_imports, required_communication }`
 * into `.architecture/invariants/layer-rules.yaml`, and the wizard records the
 * concrete pairs in the manifest's `cross_context` edges. The boundary check
 * (Boundary Violation, elsewhere in the linter) is *negative* — it forbids direct
 * sibling imports. On its own that passes even for a strict project with **no
 * transport at all**, so it doesn't actually prove the declared communication
 * exists.
 *
 * This check is the *positive* half: for every declared `cross_context` edge, the
 * transport ports the emitter is contracted to produce MUST be present. A strict
 * project whose transport is missing (or was stripped) now fails the linter, so
 * the invariant guards real code rather than merely resembling it.
 */

export interface RequiredCommunicationViolation {
  type: "missing-transport";
  enforcement: "error";
  consumer: string;
  provider: string;
  transport: string;
  /**
   * Root-relative path (`<workspacesDir>/<ctx>/...`) of the missing port.
   *
   * The workspace directory is read off `pkgRootPath` rather than hard-coded to
   * `packages/`, because the CLI derives it from `manifest.monorepo.workspaces`
   * and this string is both shown to a human and used as the ratchet-baseline
   * file key — a hard-coded prefix would name a path that does not exist in a
   * project whose workspace directory is, say, `modules/`.
   */
  missingPort: string;
  message: string;
}

/** A manifest cross-context edge (tolerant shape — read from an untrusted manifest). */
export interface CrossContextEdgeInput {
  consumer?: string;
  provider?: string;
  transport?: string;
}

interface ExpectedPort {
  /** Bounded context that must own the port. */
  context: string;
  /** Human role for the message. */
  role: string;
  /** Path of the port within `<workspacesDir>/<context>/`. */
  relPath: string;
}

/**
 * The transport ports an edge is contracted to produce, mirroring the
 * `generateCrossContext` emitter (`@hexagen/sync`):
 * - event-bus: provider publishes (`message-publisher` out-port), consumer
 *   subscribes (`event-listener` in-port);
 * - network: provider serves (`rest-controller` in-port), consumer calls
 *   (`external-service-client` out-port).
 * Unknown transports yield no expectations (nothing to enforce).
 */
function expectedPorts(
  consumer: string,
  provider: string,
  transport: string,
): ExpectedPort[] {
  if (transport === "network") {
    return [
      {
        context: provider,
        role: "controller (rest-controller in-port)",
        relPath: "src/application/ports/in/rest-controller.in-port.ts",
      },
      {
        context: consumer,
        role: "client (external-service-client out-port)",
        relPath:
          "src/application/ports/out/external-service-client.out-port.ts",
      },
    ];
  }
  if (transport === "event-bus") {
    return [
      {
        context: provider,
        role: "publisher (message-publisher out-port)",
        relPath: "src/application/ports/out/message-publisher.out-port.ts",
      },
      {
        context: consumer,
        role: "subscriber (event-listener in-port)",
        relPath: "src/application/ports/in/event-listener.in-port.ts",
      },
    ];
  }
  return [];
}

/**
 * Check that every declared cross-context edge has its transport ports on disk.
 *
 * @param edges        `manifest.cross_context` (or undefined).
 * @param pkgRootPath  Absolute path to the workspace package directory
 *                     (`packages/` by convention; whatever
 *                     `manifest.monorepo.workspaces` declares in practice).
 * @param fileExists   Predicate for an absolute file path (injected for testing).
 */
export function checkRequiredCommunication(
  edges: CrossContextEdgeInput[] | undefined,
  pkgRootPath: string,
  fileExists: (absPath: string) => boolean,
): RequiredCommunicationViolation[] {
  if (!Array.isArray(edges)) return [];

  // Context names come from an unvalidated manifest and are joined into paths, so a
  // crafted `..`/separator name could make the check probe arbitrary filesystem
  // locations. Resolve each candidate and confirm it stays within packages/ before
  // touching the filesystem (defense-in-depth; the emitter applies the same guard
  // when writing).
  const root = path.resolve(pkgRootPath);
  // The workspace directory as the repo spells it (`packages`, `modules`, …).
  // The CLI builds pkgRootPath as ROOT_DIR/<one manifest workspace segment>, so
  // its basename IS that segment — reported and baselined paths therefore match
  // the project's real layout instead of assuming `packages/`.
  const wsDir = path.basename(root);
  const violations: RequiredCommunicationViolation[] = [];
  for (const edge of edges) {
    const { consumer, provider, transport } = edge;
    if (!consumer || !provider || !transport) continue;

    for (const port of expectedPorts(consumer, provider, transport)) {
      const absPath = path.resolve(pkgRootPath, port.context, port.relPath);
      if (absPath !== root && !absPath.startsWith(root + path.sep)) {
        violations.push({
          type: "missing-transport",
          enforcement: "error",
          consumer,
          provider,
          transport,
          missingPort: `${wsDir}/${port.context}/${port.relPath}`,
          message: `required_communication violation: '${consumer}' -> '${provider}' uses an unsafe context name '${port.context}' that resolves outside ${wsDir}/ — refusing to probe the filesystem`,
        });
        continue;
      }
      if (!fileExists(absPath)) {
        violations.push({
          type: "missing-transport",
          enforcement: "error",
          consumer,
          provider,
          transport,
          missingPort: `${wsDir}/${port.context}/${port.relPath}`,
          message: `required_communication violation: '${consumer}' -> '${provider}' declares ${transport} transport, but the ${port.role} is missing at ${wsDir}/${port.context}/${port.relPath}`,
        });
      }
    }
  }
  return violations;
}
