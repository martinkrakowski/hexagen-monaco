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
 * Per-context card showing the hexagonal split of driving (west,
 * inbound) vs driven (east, outbound) adapters. Two PortColumn
 * instances in a 2-column grid.
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

  return (
    <div className="border border-border rounded-lg p-0 space-y-4 bg-card">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <span className="text-xs font-mono text-muted-foreground">
          {contextIndex + 1}.
        </span>
        <h3 className="font-medium">{context.name || "Unnamed"}</h3>
      </div>

      <div className="grid grid-cols-2 gap-6 pt-0 p-2">
        <PortColumn
          title="West: Inbound Ports"
          description="Driving adapters that receive requests"
          name={`${fieldPrefix}.inbound`}
          ports={INBOUND_PORTS}
          selectedPorts={portConfig.inboundPorts ?? []}
          onToggle={onToggleInbound}
        />
        <PortColumn
          title="East: Outbound Ports"
          description="Driven adapters that make external calls"
          name={`${fieldPrefix}.outbound`}
          ports={OUTBOUND_PORTS}
          selectedPorts={portConfig.outboundPorts ?? []}
          onToggle={onToggleOutbound}
        />
      </div>
    </div>
  );
}
