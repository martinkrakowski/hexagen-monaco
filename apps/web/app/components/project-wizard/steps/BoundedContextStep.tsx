"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";
import { v4 as uuidv4 } from "uuid";

interface BoundedContextStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
}

export function BoundedContextStep({
  onNext,
  onBack,
  canProceed,
}: BoundedContextStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();

  const boundedContexts = watch("boundedContexts") || [];

  const handleNext = () => {
    onNext();
  };

  const handleAddContext = () => {
    const newContext: BoundedContext = {
      id: uuidv4(),
      name: "",
      description: "",
      infrastructureTarget: "nestjs",
      coreDomainEntities: [],
      entities: [],
      useCases: [],
      portConfiguration: {
        inboundPorts: [],
        outboundPorts: [],
      },
      apiFramework: "NestJS",
      uiFramework: "Next.js",
      persistenceAdapter: "Prisma",
      messagingAdapter: "BullMQ",
      telemetryProvider: "None",
      externalApiPorts: [],
      llmProviders: [],
      blockchainNetworks: [],
      authenticationProvider: "",
      emailService: "",
      paymentGateway: "",
      storageProvider: "",
      searchService: "",
      webhookEndpoints: [],
    };
    const newContexts = [...boundedContexts, newContext];
    setValue("boundedContexts", newContexts);
  };

  const handleRemoveContext = (index: number) => {
    if (boundedContexts.length <= 1) return;
    const newContexts = [...boundedContexts];
    newContexts.splice(index, 1);
    setValue("boundedContexts", newContexts);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Bounded Contexts</h2>
        <button
          type="button"
          onClick={handleAddContext}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
        >
          Add Context
        </button>
      </div>

      {boundedContexts.length === 0 ? (
        <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
          <p className="text-sm text-muted-foreground mb-4">
            No bounded contexts defined. Add at least one context to continue.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {boundedContexts.map((context: BoundedContext, index: number) => (
            <div
              key={context.id}
              className="border rounded-lg p-4 space-y-4 bg-card"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
                    {index + 1}.
                  </span>
                  <input
                    name={`boundedContexts.${index}.name`}
                    value={context.name}
                    onChange={(e) => {
                      const newContexts = [...boundedContexts];
                      newContexts[index].name = e.target.value;
                      setValue("boundedContexts", newContexts);
                    }}
                    className="flex-1 px-3 py-2 border rounded-md text-sm font-medium"
                    placeholder="Context name (required)"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveContext(index)}
                  disabled={boundedContexts.length === 1}
                  aria-label={`Remove context ${context.name || index + 1}`}
                  className="px-2 py-1 text-xs text-destructive hover:text-destructive/90 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between pt-6">
        <button
          type="button"
          onClick={onBack}
          disabled={!canProceed}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-muted-foreground/75 transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={
            !canProceed ||
            boundedContexts.length === 0 ||
            boundedContexts.some((c: BoundedContext) => !c.name?.trim())
          }
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
