"use client";

import type { BoundedContext } from "@hexagen/project-configuration";

import { SummarySection } from "./SummarySection";

interface BoundedContextsSummaryProps {
  boundedContexts: BoundedContext[];
}

interface PortBadgeProps {
  count: number;
  direction: "in" | "out";
}

function PortBadge({ count, direction }: PortBadgeProps) {
  return (
    <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
      {count} {direction}
    </span>
  );
}

/**
 * Read-only list of bounded contexts with their infrastructure
 * target and port-count badges. Rendered verbatim from the form
 * state — no editing here.
 */
export function BoundedContextsSummary({
  boundedContexts,
}: BoundedContextsSummaryProps) {
  return (
    <SummarySection title={`Bounded Contexts (${boundedContexts.length})`}>
      <div className="space-y-2">
        {boundedContexts.map((ctx, i) => {
          const inboundPorts = ctx.portConfiguration?.inboundPorts;
          const outboundPorts = ctx.portConfiguration?.outboundPorts;
          return (
            <div key={ctx.id} className="flex items-center gap-2 text-sm">
              <span className="text-xs font-mono text-muted-foreground">
                {i + 1}.
              </span>
              <span className="font-medium">{ctx.name || "Unnamed"}</span>
              <span className="text-muted-foreground text-xs">
                ({ctx.infrastructureTarget || "nitro"})
              </span>
              {inboundPorts && (
                <PortBadge count={inboundPorts.length} direction="in" />
              )}
              {outboundPorts && (
                <PortBadge count={outboundPorts.length} direction="out" />
              )}
            </div>
          );
        })}
      </div>
    </SummarySection>
  );
}
