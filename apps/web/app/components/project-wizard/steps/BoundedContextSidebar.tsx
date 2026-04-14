"use client";

import { useState, useRef, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { AlertTriangle, Plus, X } from "lucide-react";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";
import { v4 as uuidv4 } from "uuid";

interface BoundedContextSidebarProps {
  activeContextId: string;
  onContextSelect: (contextId: string) => void;
}

export function BoundedContextSidebar({
  activeContextId,
  onContextSelect,
}: BoundedContextSidebarProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingContextId, setEditingContextId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingContextId && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingContextId]);

  useEffect(() => {
    if (boundedContexts.length > 0 && !activeContextId) {
      onContextSelect(boundedContexts[0].id);
    }
  }, [boundedContexts, activeContextId, onContextSelect]);

  const handleAddContext = () => {
    const newContext: BoundedContext = {
      id: uuidv4(),
      name: "",
      description: "",
      infrastructureTarget: "nestjs",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      entities: [],
      useCases: [],
      portConfiguration: {
        inboundPorts: [],
        outboundPorts: [],
      },
      apiFramework: "NestJS",
      uiFramework: "",
      persistenceAdapter: "",
      messagingAdapter: "",
      telemetryProvider: "",
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
    setEditingContextId(newContext.id);
    onContextSelect(newContext.id);
  };

  const handleDeleteContext = (contextId: string) => {
    const indexToDelete = boundedContexts.findIndex((c) => c.id === contextId);
    if (indexToDelete >= 0) {
      const newContexts = [...boundedContexts];
      newContexts.splice(indexToDelete, 1);
      setValue("boundedContexts", newContexts);
      if (activeContextId === contextId) {
        const newActiveIndex = Math.min(indexToDelete, newContexts.length - 1);
        const newActiveId = newContexts[newActiveIndex]?.id ?? "";
        onContextSelect(newActiveId);
      }
    }
    setConfirmDeleteId(null);
  };

  const handleContextClick = (contextId: string) => {
    if (editingContextId !== contextId) {
      onContextSelect(contextId);
    }
  };

  const handleNameChange = (contextId: string, name: string) => {
    const index = boundedContexts.findIndex((c) => c.id === contextId);
    if (index >= 0) {
      const newContexts = [...boundedContexts];
      newContexts[index] = { ...newContexts[index], name };
      setValue("boundedContexts", newContexts);
    }
  };

  const handleNameBlur = (contextId: string) => {
    setEditingContextId(null);
    onContextSelect(contextId);
  };

  const handleNameKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    contextId: string,
  ) => {
    if (e.key === "Enter") {
      setEditingContextId(null);
      onContextSelect(contextId);
    } else if (e.key === "Escape") {
      const context = boundedContexts.find((c) => c.id === contextId);
      if (!context?.name) {
        handleDeleteContext(contextId);
      }
      setEditingContextId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          Bounded Contexts
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {boundedContexts.length} context
          {boundedContexts.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {boundedContexts.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No contexts defined
          </div>
        ) : (
          boundedContexts.map((context: BoundedContext) => (
            <div
              key={context.id}
              role="button"
              tabIndex={0}
              onClick={() => handleContextClick(context.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleContextClick(context.id);
                }
              }}
              className={`relative w-full text-left p-3 border border-border rounded-lg cursor-pointer transition-[border-color,background-color] ${
                activeContextId === context.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:border-input"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-muted-foreground">
                  <span className="text-xs font-bold">
                    {context.name?.charAt(0).toUpperCase() || "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  {editingContextId === context.id ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={context.name}
                      onChange={(e) =>
                        handleNameChange(context.id, e.target.value)
                      }
                      onBlur={() => handleNameBlur(context.id)}
                      onKeyDown={(e) => handleNameKeyDown(e, context.id)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Context name..."
                      className="w-full min-w-[100px] bg-transparent outline-none text-sm text-foreground placeholder-muted-foreground py-0.5"
                    />
                  ) : (
                    <>
                      <h3 className="font-medium text-sm text-foreground truncate">
                        {context.name || "Unnamed Context"}
                      </h3>
                      <p className="text-[10px] text-muted-foreground">
                        {(context.coreDomainEntities?.length ?? 0) +
                          (context.useCases?.length ?? 0)}{" "}
                        items
                      </p>
                    </>
                  )}
                </div>
              </div>

              {boundedContexts.length > 1 &&
                boundedContexts[0].id !== context.id &&
                (confirmDeleteId === context.id ? (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="h-4 w-4 text-destructive"
                    />
                    <span className="text-xs font-medium text-destructive">
                      Delete?
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteContext(context.id);
                      }}
                      className="px-2 py-1 text-xs font-medium text-destructive-foreground bg-destructive rounded hover:bg-destructive/90"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                      className="px-2 py-1 text-xs font-medium text-foreground bg-muted rounded hover:bg-muted"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(context.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setConfirmDeleteId(context.id);
                      }
                    }}
                    className="absolute top-1 right-1 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    aria-label="Delete context"
                  >
                    <X aria-hidden="true" className="h-3 w-3" />
                  </span>
                ))}
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-border">
        <button
          type="button"
          onClick={handleAddContext}
          className="w-full py-2 px-3 border border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add Context
        </button>
      </div>
    </div>
  );
}
