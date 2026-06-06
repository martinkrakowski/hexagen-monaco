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
  /** Workspace-relative path (`packages/<ctx>/...`) of the missing port. */
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
  /** Path of the port within `packages/<context>/`. */
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
 * @param pkgRootPath  Absolute path to the workspace `packages/` directory.
 * @param fileExists   Predicate for an absolute file path (injected for testing).
 */
export function checkRequiredCommunication(
  edges: CrossContextEdgeInput[] | undefined,
  pkgRootPath: string,
  fileExists: (absPath: string) => boolean,
): RequiredCommunicationViolation[] {
  if (!Array.isArray(edges)) return [];

  const violations: RequiredCommunicationViolation[] = [];
  for (const edge of edges) {
    const { consumer, provider, transport } = edge;
    if (!consumer || !provider || !transport) continue;

    for (const port of expectedPorts(consumer, provider, transport)) {
      const absPath = path.join(pkgRootPath, port.context, port.relPath);
      if (!fileExists(absPath)) {
        violations.push({
          type: "missing-transport",
          enforcement: "error",
          consumer,
          provider,
          transport,
          missingPort: `packages/${port.context}/${port.relPath}`,
          message: `required_communication violation: '${consumer}' -> '${provider}' declares ${transport} transport, but the ${port.role} is missing at packages/${port.context}/${port.relPath}`,
        });
      }
    }
  }
  return violations;
}
