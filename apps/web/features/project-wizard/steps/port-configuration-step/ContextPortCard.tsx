"use client";

import type { BoundedContext } from "@hexagen/project-configuration";

import { PortColumn } from "./PortColumn";
import {
  INBOUND_PORTS,
  OUTBOUND_PORTS,
  type InboundPortValue,
  type OutboundPortValue,
} from "./port-catalog";

interface ContextPortCardProps {
  context: BoundedContext;
  contextIndex: number;
  onToggleInbound: (port: InboundPortValue) => void;
  onToggleOutbound: (port: OutboundPortValue) => void;
}

/**
 * Per-context card showing the three compass-aligned port groups:
 *
 *   North: APIs                 — driving / machine-driven entry points
 *   East:  State & Storage      — driven / persistence adapters
 *   South: External Integrations — driven / 3rd-party service adapters
 *
 * The WEST side (Presentation) is configured via the separate `uiFramework`
 * field on an earlier step and is intentionally absent from this panel.
 */
export function ContextPortCard({
  context,
  contextIndex,
  onToggleInbound,
  onToggleOutbound,
}: ContextPortCardProps) {
  const portConfig = context.portConfiguration ?? {
    inboundPorts: [],
    outboundPorts: [],
  };

  const fieldPrefix = `boundedContexts.${contextIndex}.portConfiguration`;

  const eastOutboundPorts = OUTBOUND_PORTS.filter(
    (entry) => entry.compass === "east",
  );
  const southOutboundPorts = OUTBOUND_PORTS.filter(
    (entry) => entry.compass === "south",
  );

  return (
    <div className="border border-border rounded-lg p-0 space-y-4 bg-card">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <span className="text-xs font-mono text-muted-foreground">
          {contextIndex + 1}.
        </span>
        <h3 className="font-medium">{context.name || "Unnamed"}</h3>
      </div>

      <div className="grid grid-cols-3 gap-6 pt-0 p-2">
        <PortColumn
          title="North: APIs"
          description="Machine-driven entry points (REST, GraphQL, events, CLI)"
          name={`${fieldPrefix}.inbound`}
          ports={INBOUND_PORTS}
          selectedPorts={portConfig.inboundPorts ?? []}
          onToggle={onToggleInbound}
        />
        <PortColumn
          title="East: State & Storage"
          description="Persistence adapters (databases, caches, stores)"
          name={`${fieldPrefix}.outbound.east`}
          ports={eastOutboundPorts}
          selectedPorts={portConfig.outboundPorts ?? []}
          onToggle={onToggleOutbound}
        />
        <PortColumn
          title="South: External Integrations"
          description="3rd-party service clients (APIs, messaging, email)"
          name={`${fieldPrefix}.outbound.south`}
          ports={southOutboundPorts}
          selectedPorts={portConfig.outboundPorts ?? []}
          onToggle={onToggleOutbound}
        />
      </div>
    </div>
  );
}
