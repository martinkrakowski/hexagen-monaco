"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Layers, GitBranch, Zap } from "lucide-react";

interface ContextInfo {
  boundedContexts: number;
  ports: number;
  adapters: number;
  currentStep?: string;
}

interface AgentContextBarProps {
  context: ContextInfo;
  className?: string;
}

export function AgentContextBar({ context, className }: AgentContextBarProps) {
  const contextSummary = useMemo(() => {
    return [
      {
        label: "Contexts",
        value: context.boundedContexts,
        icon: Layers,
      },
      {
        label: "Ports",
        value: context.ports,
        icon: GitBranch,
      },
      {
        label: "Adapters",
        value: context.adapters,
        icon: Zap,
      },
    ];
  }, [context.boundedContexts, context.ports, context.adapters]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-1.5 bg-muted/50 border-b border-border text-xs",
        className,
      )}
    >
      <span className="text-muted-foreground">Project Context:</span>
      <div className="flex items-center gap-2">
        {contextSummary.map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <item.icon className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium">{item.value}</span>
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
      {context.currentStep && (
        <span className="ml-auto px-2 py-0.5 text-xs rounded bg-secondary text-secondary-foreground">
          {context.currentStep}
        </span>
      )}
    </div>
  );
}
