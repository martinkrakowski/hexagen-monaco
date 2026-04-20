"use client";

import { ArrowLeft } from "lucide-react";
import type {
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";

import { MappingFormContexts } from "./MappingFormContexts";
import { MappingFormIntegration } from "./MappingFormIntegration";
import { getContextName } from "./mapping-identity";

interface MappingFormProps {
  mapping: PeerContextMapping;
  boundedContexts: BoundedContext[];
  isStrictTemplate: boolean;
  onBack: () => void;
  onUpdate: (updates: Partial<PeerContextMapping>) => void;
}

/**
 * Detail view for a single peer mapping. Composes:
 *   1. "Back to mapping list" button
 *   2. MappingFormContexts — consumer + provider selects
 *   3. MappingFormIntegration — pattern + boundary selects
 */
export function MappingForm({
  mapping,
  boundedContexts,
  isStrictTemplate,
  onBack,
  onUpdate,
}: MappingFormProps) {
  const contextOptions = boundedContexts.map((ctx) => ({
    id: ctx.id,
    name: ctx.name || "Unnamed Context",
  }));

  const consumerName = getContextName(mapping.consumerContext, boundedContexts);
  const providerName = getContextName(mapping.providerContext, boundedContexts);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-2">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to mapping list
      </button>

      <div className="space-y-6">
        <MappingFormContexts
          mapping={mapping}
          contextOptions={contextOptions}
          onUpdate={onUpdate}
        />

        <MappingFormIntegration
          mapping={mapping}
          consumerName={consumerName}
          providerName={providerName}
          isStrictTemplate={isStrictTemplate}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}
