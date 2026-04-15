"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
  PortConfiguration,
} from "@hexagen/project-configuration";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface PortConfigurationStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
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
  totalSteps = 6,
  title,
  description,
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
      <div className="flex flex-col h-full bg-card">
        <StepHeader
          currentStep={currentStep}
          totalSteps={totalSteps}
          title={title || "Ports Configuration"}
          description={description || "Configure ports for each context."}
        />
        <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-4">
          <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
            <p className="text-sm text-muted-foreground">
              No bounded contexts available. Add contexts first.
            </p>
          </div>
        </div>
        <WizardFooter
          onBack={onBack}
          onNext={onNext}
          canProceed={canProceed}
          currentStep={currentStep}
          totalSteps={totalSteps}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Ports Configuration"}
        description={description || "Configure ports for each context."}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="space-y-6">
          <div className="space-y-6">
            {boundedContexts.map((context: BoundedContext, index: number) => {
              const portConfig = context.portConfiguration || {
                inboundPorts: [],
                outboundPorts: [],
              };

              return (
                <div
                  key={context.id}
                  className="border border-border rounded-lg p-4 space-y-4 bg-muted"
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

      <WizardFooter
        onBack={onBack}
        onNext={onNext}
        canProceed={canProceed}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
}
