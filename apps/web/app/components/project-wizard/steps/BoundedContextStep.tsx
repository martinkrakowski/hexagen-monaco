"use client";

import { useState, type KeyboardEvent } from "react";
import { useFormContext } from "react-hook-form";
import { AlertTriangle, X, Layers } from "lucide-react";
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
              <X />
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
  const [activeContextId, setActiveContextId] = useState<string | null>(
    boundedContexts.length > 0 ? boundedContexts[0].id : null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    // Set the newly added context as active
    setActiveContextId(newContext.id);
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
        <>
          {/* --- THE TILES (Master) --- */}
          <div className="flex flex-wrap gap-1 mb-6">
            {boundedContexts.map((context: BoundedContext) => (
              <div
                key={context.id}
                // Clicking the tile changes the active context
                onClick={() => setActiveContextId(context.id)}
                className={`relative p-4 border rounded-lg ${
                  boundedContexts.length === 1
                    ? "w-full"
                    : "min-w-[33.333%] max-w-[50%]"
                } ${
                  activeContextId === context.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 bg-white"
                }
                 `}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500">
                    <Layers />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-medium text-sm">
                      {context.name || "Unnamed Context"}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex h-6 items-center gap-1 px-2 rounded-full bg-gray-100 text-[10px]">
                        {(context.coreDomainEntities?.length ?? 0) +
                          (context.useCases?.length ?? 0)}{" "}
                        items
                      </div>
                    </div>
                  </div>
                </div>
                {boundedContexts.length > 1 &&
                  boundedContexts[0].id !== context.id &&
                  (confirmDeleteId === context.id ? (
                    <div
                      className="absolute bottom-1 right-1 flex items-center gap-1 bg-white/95 backdrop-blur-sm border border-destructive/30 rounded-md px-2 py-1 shadow-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                      <span className="mt-1 text-[10px] font-medium text-destructive">
                        Delete?
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const indexToDelete = boundedContexts.findIndex(
                            (c) => c.id === context.id,
                          );
                          if (indexToDelete >= 0) {
                            const newContexts = [...boundedContexts];
                            newContexts.splice(indexToDelete, 1);
                            setValue("boundedContexts", newContexts);
                            if (activeContextId === context.id) {
                              const newActiveIndex = Math.min(
                                indexToDelete,
                                newContexts.length - 1,
                              );
                              setActiveContextId(
                                newContexts[newActiveIndex]?.id ?? null,
                              );
                            }
                          }
                          setConfirmDeleteId(null);
                        }}
                        className="p-1.5 rounded text-destructive hover:bg-destructive/20"
                        aria-label="Confirm delete"
                      >
                        <span className="text-[10px] font-medium">Yes</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        className="p-1.5 rounded text-muted-foreground hover:bg-muted"
                        aria-label="Cancel delete"
                      >
                        <span className="mt-2 text-[10px] font-medium">No</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(context.id);
                      }}
                      className="absolute bottom-1 right-1 p-1 rounded-full text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Delete context"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ))}
              </div>
            ))}
          </div>

          {/* --- THE FORM (Detail) --- */}
          {/* Find the specific context and render ONLY its form */}
          {boundedContexts.map((context: BoundedContext) => {
            if (context.id !== activeContextId) return null; // Hide all others

            return (
              <div key={context.id} className="space-y-4">
                {/* Field 1: Context Name (Text Input) */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Context Name
                  </label>
                  <input
                    name={`boundedContexts.${boundedContexts.findIndex((c) => c.id === context.id)}.name`}
                    value={context.name}
                    onChange={(e) => {
                      const index = boundedContexts.findIndex(
                        (c) => c.id === context.id,
                      );
                      updateContext(index, (ctx) => ({
                        ...ctx,
                        name: e.target.value,
                      }));
                    }}
                    className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm font-medium"
                    placeholder="Context name (required)"
                  />
                </div>

                {/* Field 2: Core Domain Entities (Tokenized Input) */}
                <ChipInput
                  label="Core Domain Entities"
                  placeholder="e.g. Invoice, User, Catalog"
                  name={`boundedContexts.${boundedContexts.findIndex((c) => c.id === context.id)}.coreDomainEntities`}
                  values={context.coreDomainEntities || []}
                  onChange={(values) => {
                    const index = boundedContexts.findIndex(
                      (c) => c.id === context.id,
                    );
                    updateContext(index, (ctx) => ({
                      ...ctx,
                      coreDomainEntities: values,
                    }));
                  }}
                />

                {/* Field 3: Primary Use Cases (Tokenized Input) */}
                <ChipInput
                  label="Primary Use Cases"
                  placeholder="e.g. CreateInvoice, ProcessPayment"
                  name={`boundedContexts.${boundedContexts.findIndex((c) => c.id === context.id)}.useCases`}
                  values={context.useCases || []}
                  onChange={(values) => {
                    const index = boundedContexts.findIndex(
                      (c) => c.id === context.id,
                    );
                    updateContext(index, (ctx) => ({
                      ...ctx,
                      useCases: values,
                    }));
                  }}
                />

                {/* Fields 4 & 5: Infrastructure Targets (Split Grid Dropdowns) */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      API / Backend
                    </label>
                    <select
                      value={context.infrastructureTarget || ""}
                      onChange={(e) => {
                        const index = boundedContexts.findIndex(
                          (c) => c.id === context.id,
                        );
                        updateContext(index, (ctx) => ({
                          ...ctx,
                          infrastructureTarget: e.target
                            .value as BoundedContext["infrastructureTarget"],
                        }));
                      }}
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
                      onChange={(e) => {
                        const index = boundedContexts.findIndex(
                          (c) => c.id === context.id,
                        );
                        updateContext(index, (ctx) => ({
                          ...ctx,
                          uiFramework: e.target
                            .value as BoundedContext["uiFramework"],
                        }));
                      }}
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
            );
          })}
        </>
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
