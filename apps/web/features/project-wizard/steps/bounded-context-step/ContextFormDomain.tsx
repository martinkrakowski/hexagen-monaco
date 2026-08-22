"use client";

import { useFormContext } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import { ChipInput } from "@/ChipInput";

interface ContextFormDomainProps {
  fieldPrefix: string;
}

export function ContextFormDomain({ fieldPrefix }: ContextFormDomainProps) {
  const { setValue, watch } = useFormContext<ProjectConfig>();

  const coreDomainEntities =
    (watch(
      `${fieldPrefix}.coreDomainEntities` as FieldPath<ProjectConfig>,
    ) as string[]) || [];
  const valueObjects =
    (watch(
      `${fieldPrefix}.valueObjects` as FieldPath<ProjectConfig>,
    ) as string[]) || [];
  const useCases =
    (watch(
      `${fieldPrefix}.useCases` as FieldPath<ProjectConfig>,
    ) as string[]) || [];
  const domainEvents =
    (watch(
      `${fieldPrefix}.domainEvents` as FieldPath<ProjectConfig>,
    ) as string[]) || [];

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
            values={coreDomainEntities}
            onChange={(values) =>
              setValue(
                `${fieldPrefix}.coreDomainEntities` as FieldPath<ProjectConfig>,
                values,
                {
                  shouldDirty: true,
                },
              )
            }
          />
          <ChipInput
            label="Value Objects"
            placeholder="e.g. Money, Address"
            name={`${fieldPrefix}.valueObjects`}
            values={valueObjects}
            onChange={(values) =>
              setValue(
                `${fieldPrefix}.valueObjects` as FieldPath<ProjectConfig>,
                values,
                {
                  shouldDirty: true,
                },
              )
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
            values={useCases}
            onChange={(values) =>
              setValue(
                `${fieldPrefix}.useCases` as FieldPath<ProjectConfig>,
                values,
                {
                  shouldDirty: true,
                },
              )
            }
          />
          <ChipInput
            label="Domain Events"
            placeholder="e.g. OrderPlaced"
            name={`${fieldPrefix}.domainEvents`}
            values={domainEvents}
            onChange={(values) =>
              setValue(
                `${fieldPrefix}.domainEvents` as FieldPath<ProjectConfig>,
                values,
                {
                  shouldDirty: true,
                },
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
