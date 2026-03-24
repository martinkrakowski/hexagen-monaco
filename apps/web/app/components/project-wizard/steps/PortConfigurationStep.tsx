"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
  PortConfiguration,
} from "@hexagen/project-configuration";

interface PortConfigurationStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  currentStep?: number;
  totalSteps?: number;
}

const INBOUND_PORTS = [
  { value: "rest-controller", label: "REST Controller" },
  { value: "graphql-resolver", label: "GraphQL Resolver" },
  { value: "event-listener", label: "Event/Queue Listener" },
  { value: "cli-command", label: "CLI Command" },
] as const;

const OUTBOUND_PORTS = [
  { value: "relational-db", label: "Relational DB Repository" },
  { value: "document-db", label: "Document DB Repository" },
  { value: "external-service-client", label: "External Service Client" },
  { value: "message-publisher", label: "Message Publisher" },
] as const;

export function PortConfigurationStep({
  onNext,
  onBack,
  canProceed,
  currentStep = 4,
  totalSteps = 4,
}: PortConfigurationStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();

  const boundedContexts = watch("boundedContexts") || [];

  const handleTogglePort = (
    contextIndex: number,
    direction: "inbound" | "outbound",
    port: string,
  ) => {
    const currentContext = boundedContexts[contextIndex];
    if (!currentContext) return;

    const nextPortConfig: PortConfiguration = {
      inboundPorts: [...(currentContext.portConfiguration?.inboundPorts ?? [])],
      outboundPorts: [
        ...(currentContext.portConfiguration?.outboundPorts ?? []),
      ],
    };

    const nextContext: BoundedContext = {
      ...currentContext,
      portConfiguration: nextPortConfig,
    };

    if (direction === "inbound") {
      const currentPorts = nextPortConfig.inboundPorts;
      const newPorts = currentPorts.includes(port as never)
        ? currentPorts.filter((p) => p !== port)
        : [...currentPorts, port as PortConfiguration["inboundPorts"][number]];
      nextPortConfig.inboundPorts = newPorts;
    } else {
      const currentPorts = nextPortConfig.outboundPorts;
      const newPorts = currentPorts.includes(port as never)
        ? currentPorts.filter((p) => p !== port)
        : [...currentPorts, port as PortConfiguration["outboundPorts"][number]];
      nextPortConfig.outboundPorts = newPorts;
    }

    const nextContexts = [...boundedContexts];
    nextContexts[contextIndex] = nextContext;
    setValue("boundedContexts", nextContexts);
  };

  if (boundedContexts.length === 0) {
    return (
      <div className="flex flex-col h-full bg-white overflow-hidden">
        <div className="flex-shrink-0 p-6 pb-4">
          <div className="text-[10px] font-mono bg-black text-green-400 p-2 rounded mb-4">
            STEP: 4 (port_configuration)
          </div>
          <div className="flex gap-2 mb-4">
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              1
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              2
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              3
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-primary text-primary-foreground border-primary">
              4
            </div>
            <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
              5
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-2">Port Configuration</h2>
          <p className="text-muted-foreground mb-6 text-sm">
            Configure inbound and outbound ports for each context.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-6 max-w-2xl lg:max-w-2xl">
            <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
              <p className="text-sm text-muted-foreground">
                No bounded contexts available. Add contexts first.
              </p>
            </div>
          </div>
        </div>

        <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-10">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-300"
          >
            Back
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">
              Step {currentStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!canProceed}
              className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="flex-shrink-0 p-6 pb-4">
        <div className="text-[10px] font-mono bg-black text-green-400 p-2 rounded mb-4">
          STEP: 4 (port_configuration)
        </div>
        <div className="flex gap-2 mb-4">
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            1
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            2
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            3
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-primary text-primary-foreground border-primary">
            4
          </div>
          <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm bg-muted text-muted-foreground border-muted">
            5
          </div>
        </div>
        <h2 className="text-2xl font-semibold mb-2">Port Configuration</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Configure inbound and outbound ports for each context.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-6 max-w-2xl lg:max-w-2xl">
          <div className="space-y-6">
            {boundedContexts.map((context: BoundedContext, index: number) => {
              const portConfig = context.portConfiguration || {
                inboundPorts: [],
                outboundPorts: [],
              };

              return (
                <div
                  key={context.id}
                  className="border rounded-lg p-4 space-y-4 bg-card"
                >
                  <div className="flex items-center gap-2 border-b border-border pb-3">
                    <span className="text-xs font-mono text-muted-foreground">
                      {index + 1}.
                    </span>
                    <h3 className="font-medium">{context.name || "Unnamed"}</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    {/* Inbound Ports (West) */}
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                          West: Inbound Ports
                        </h4>
                        <p className="text-[10px] text-muted-foreground">
                          Driving adapters that receive requests
                        </p>
                      </div>
                      <div className="space-y-2">
                        {INBOUND_PORTS.map((port) => (
                          <label
                            key={port.value}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded"
                          >
                            <input
                              type="checkbox"
                              name={`boundedContexts.${index}.portConfiguration.inbound.${port.value}`}
                              checked={portConfig.inboundPorts?.includes(
                                port.value as never,
                              )}
                              onChange={() =>
                                handleTogglePort(index, "inbound", port.value)
                              }
                              className="h-4 w-4 accent-primary"
                            />
                            <span className="text-xs">{port.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Outbound Ports (East) */}
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                          East: Outbound Ports
                        </h4>
                        <p className="text-[10px] text-muted-foreground">
                          Driven adapters that make external calls
                        </p>
                      </div>
                      <div className="space-y-2">
                        {OUTBOUND_PORTS.map((port) => (
                          <label
                            key={port.value}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded"
                          >
                            <input
                              type="checkbox"
                              name={`boundedContexts.${index}.portConfiguration.outbound.${port.value}`}
                              checked={portConfig.outboundPorts?.includes(
                                port.value as never,
                              )}
                              onChange={() =>
                                handleTogglePort(index, "outbound", port.value)
                              }
                              className="h-4 w-4 accent-primary"
                            />
                            <span className="text-xs">{port.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-10">
        <button
          type="button"
          onClick={onBack}
          disabled={!canProceed}
          className="px-6 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors border border-slate-300 disabled:opacity-50"
        >
          Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">
            Step {currentStep} of {totalSteps}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="px-8 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
