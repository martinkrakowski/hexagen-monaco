"use client";

import type { BoundedContext } from "@hexagen/project-configuration";

import { ChipInput } from "../ChipInput";

interface ContextFormDomainProps {
  context: BoundedContext;
  fieldPrefix: string;
  onUpdate: (updater: (ctx: BoundedContext) => BoundedContext) => void;
}

/**
 * Domain modelling fields for a bounded context. Four ChipInput
 * collections split into two subsections: "Nouns & State" (entities
 * and value objects) and "Verbs & Action" (use cases and events).
 *
 * `fieldPrefix` is the react-hook-form path prefix (e.g.
 * "boundedContexts.2") used by ChipInput's internal name plumbing.
 */
export function ContextFormDomain({
  context,
  fieldPrefix,
  onUpdate,
}: ContextFormDomainProps) {
  return (
    <div className="space-y-6 p-2">
      <div className="w-full">
        <div className="w-full border-b border-border mb-4 p-3">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
            Domain Model
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Nouns &amp; State
          </p>
        </div>
        <div className="p-2 space-y-4">
          <ChipInput
            label="Core Domain Entities"
            placeholder="e.g. User, Product"
            name={`${fieldPrefix}.coreDomainEntities`}
            values={context.coreDomainEntities || []}
            onChange={(values) =>
              onUpdate((ctx) => ({ ...ctx, coreDomainEntities: values }))
            }
          />
          <ChipInput
            label="Value Objects"
            placeholder="e.g. Money, Address"
            name={`${fieldPrefix}.valueObjects`}
            values={context.valueObjects || []}
            onChange={(values) =>
              onUpdate((ctx) => ({ ...ctx, valueObjects: values }))
            }
          />
        </div>
      </div>

      <div className="w-full">
        <div className="w-full border-b border-t border-border mb-4 p-3">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-widest">
            Domain Logic
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Verbs &amp; Action
          </p>
        </div>
        <div className="p-2 space-y-4">
          <ChipInput
            label="Primary Use Cases"
            placeholder="e.g. PlaceOrder"
            name={`${fieldPrefix}.useCases`}
            values={context.useCases || []}
            onChange={(values) =>
              onUpdate((ctx) => ({ ...ctx, useCases: values }))
            }
          />
          <ChipInput
            label="Domain Events"
            placeholder="e.g. OrderPlaced"
            name={`${fieldPrefix}.domainEvents`}
            values={context.domainEvents || []}
            onChange={(values) =>
              onUpdate((ctx) => ({ ...ctx, domainEvents: values }))
            }
          />
        </div>
      </div>
    </div>
  );
}
