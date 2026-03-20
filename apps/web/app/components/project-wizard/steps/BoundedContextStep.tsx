"use client";

import { useState, type KeyboardEvent } from "react";
import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";
import { v4 as uuidv4 } from "uuid";
import { apiFrameworkOptions, uiFrameworkOptions } from "../config";

interface BoundedContextStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
}

interface ChipInputProps {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  name: string;
}

function ChipInput({
  label,
  placeholder,
  values,
  onChange,
  name,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState("");

  const commitValue = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitValue();
    }
  };

  const removeValue = (value: string) => {
    onChange(values.filter((v) => v !== value));
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {values.map((val) => (
          <span
            key={val}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20"
          >
            {val}
            <button
              type="button"
              aria-label={`Remove ${val}`}
              onClick={() => removeValue(val)}
              className="h-4 w-4 inline-flex items-center justify-center rounded-full text-primary hover:bg-primary/20"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        name={name}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitValue}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
      />
      <p className="text-[10px] text-muted-foreground">
        Press Enter or comma to add.
      </p>
    </div>
  );
}

export function BoundedContextStep({
  onNext,
  onBack,
  canProceed,
}: BoundedContextStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();

  const boundedContexts = watch("boundedContexts") || [];

  const updateContext = (
    index: number,
    updater: (ctx: BoundedContext) => BoundedContext,
  ) => {
    const nextContexts = boundedContexts.map(
      (ctx: BoundedContext, i: number) => (i === index ? updater(ctx) : ctx),
    );
    setValue("boundedContexts", nextContexts, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

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
      uiFramework: "",
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
                    onChange={(e) =>
                      updateContext(index, (ctx) => ({
                        ...ctx,
                        name: e.target.value,
                      }))
                    }
                    className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm font-medium"
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

              <div className="grid grid-cols-2 gap-4">
                <ChipInput
                  label="Core Domain Entities"
                  placeholder="e.g. Invoice, User, Catalog"
                  name={`boundedContexts.${index}.coreDomainEntities`}
                  values={context.coreDomainEntities || []}
                  onChange={(values) =>
                    updateContext(index, (ctx) => ({
                      ...ctx,
                      coreDomainEntities: values,
                    }))
                  }
                />
                <ChipInput
                  label="Primary Use Cases"
                  placeholder="e.g. CreateInvoice, ProcessPayment"
                  name={`boundedContexts.${index}.useCases`}
                  values={context.useCases || []}
                  onChange={(values) =>
                    updateContext(index, (ctx) => ({
                      ...ctx,
                      useCases: values,
                    }))
                  }
                />
              </div>

              <div className="border-t border-border pt-4 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Infrastructure
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      API / Backend
                    </label>
                    <select
                      value={context.infrastructureTarget || ""}
                      onChange={(e) =>
                        updateContext(index, (ctx) => ({
                          ...ctx,
                          infrastructureTarget: e.target
                            .value as BoundedContext["infrastructureTarget"],
                        }))
                      }
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                    >
                      <option value="" disabled>
                        Select Backend Engine
                      </option>
                      {apiFrameworkOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      UI / Frontend
                    </label>
                    <select
                      value={context.uiFramework || ""}
                      onChange={(e) =>
                        updateContext(index, (ctx) => ({
                          ...ctx,
                          uiFramework: e.target
                            .value as BoundedContext["uiFramework"],
                        }))
                      }
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
                    >
                      {uiFrameworkOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
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
