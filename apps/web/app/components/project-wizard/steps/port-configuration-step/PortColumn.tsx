"use client";

import type { PortCatalogEntry } from "./port-catalog";

interface PortColumnProps<T extends string> {
  title: string;
  description: string;
  name: string;
  ports: ReadonlyArray<PortCatalogEntry<T>>;
  selectedPorts: readonly T[];
  onToggle: (port: T) => void;
}

/**
 * One hemisphere of the hexagonal port-configuration card — either
 * "West: Inbound Ports" or "East: Outbound Ports". Generic over the
 * port value union so InboundPortValue and OutboundPortValue can
 * each flow through without widening.
 *
 * Typed as <T extends string> at the boundary; consumers pass
 * InboundPortValue or OutboundPortValue; checkbox callbacks receive
 * the correctly-narrowed value (no `as never` casts).
 */
export function PortColumn<T extends string>({
  title,
  description,
  name,
  ports,
  selectedPorts,
  onToggle,
}: PortColumnProps<T>) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
          {title}
        </h4>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">
        {ports.map((port) => (
          <label
            key={port.value}
            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded"
          >
            <input
              type="checkbox"
              name={`${name}.${port.value}`}
              checked={selectedPorts.includes(port.value)}
              onChange={() => onToggle(port.value)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-xs">{port.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
