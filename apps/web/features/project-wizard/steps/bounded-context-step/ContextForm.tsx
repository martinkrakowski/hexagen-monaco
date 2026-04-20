"use client";

import { ArrowLeft } from "lucide-react";
import type { BoundedContext } from "@hexagen/project-configuration";

import { ContextFormInfrastructure } from "./ContextFormInfrastructure";
import { ContextFormDomain } from "./ContextFormDomain";

interface ContextFormProps {
  context: BoundedContext;
  fieldPrefix: string;
  onBack: () => void;
  onUpdate: (updater: (ctx: BoundedContext) => BoundedContext) => void;
}

/**
 * Detail view for a single bounded context. Renders:
 *   1. A "Back to context list" button
 *   2. The context name input
 *   3. Infrastructure choices (ContextFormInfrastructure)
 *   4. Domain model / logic (ContextFormDomain)
 *
 * Pure presentational — all state/update orchestration happens in
 * the parent BoundedContextStep via onUpdate.
 */
export function ContextForm({
  context,
  fieldPrefix,
  onBack,
  onUpdate,
}: ContextFormProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="shrink-0 p-2 space-y-3 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to context list
        </button>

        <label className="block w-full">
          <span className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
            Context Name
          </span>
          <input
            type="text"
            value={context.name}
            onChange={(e) =>
              onUpdate((ctx) => ({ ...ctx, name: e.target.value }))
            }
            className="w-full px-3 py-2 border border-input rounded-md text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none bg-background"
            placeholder="e.g. SalesContext"
          />
        </label>

        <ContextFormInfrastructure context={context} onUpdate={onUpdate} />
      </div>

      <ContextFormDomain
        context={context}
        fieldPrefix={fieldPrefix}
        onUpdate={onUpdate}
      />
    </div>
  );
}
