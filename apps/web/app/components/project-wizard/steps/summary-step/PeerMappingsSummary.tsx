"use client";

import type {
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";

import { SummarySection } from "./SummarySection";
import { getContextName } from "../peer-context-mapping-step/mapping-identity";

interface PeerMappingsSummaryProps {
  peerMappings: PeerContextMapping[];
  boundedContexts: BoundedContext[];
}

/**
 * Read-only list of peer mappings formatted as
 * `consumer → provider  (pattern, boundary)`. Context names are
 * resolved via the shared getContextName utility from the
 * peer-context-mapping-step module — same lookup, no duplication.
 *
 * The section is rendered by the parent only when peerMappings.length > 0,
 * so there's no empty state here.
 */
export function PeerMappingsSummary({
  peerMappings,
  boundedContexts,
}: PeerMappingsSummaryProps) {
  return (
    <SummarySection title={`Peer Mappings (${peerMappings.length})`}>
      <div className="space-y-2">
        {peerMappings.map((mapping, i) => {
          const consumer = getContextName(
            mapping.consumerContext,
            boundedContexts,
          );
          const provider = getContextName(
            mapping.providerContext,
            boundedContexts,
          );
          return (
            <div key={i} className="text-sm">
              <span className="font-medium">{consumer}</span>{" "}
              <span className="text-muted-foreground">→</span>{" "}
              <span className="font-medium">{provider}</span>
              <span className="text-xs text-muted-foreground ml-2">
                ({mapping.integrationPattern}, {mapping.communicationBoundary})
              </span>
            </div>
          );
        })}
      </div>
    </SummarySection>
  );
}
