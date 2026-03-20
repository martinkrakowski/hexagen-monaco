"use client";

import { useState } from "react";
import type { BoundedContext } from "@hexagen/shared";

interface StepDomainProps {
  activeContext: BoundedContext;
  contextId: string;
  onUpdateContext: (updates: Partial<BoundedContext>) => void;
}

export function StepDomain({
  activeContext,
  contextId: _contextId,
  onUpdateContext,
}: StepDomainProps) {
  const [newEntityName, setNewEntityName] = useState("");
  const [newUseCaseName, setNewUseCaseName] = useState("");

  const handleAddEntity = () => {
    if (!newEntityName.trim()) return;
    onUpdateContext({
      entities: [...(activeContext.entities || []), newEntityName.trim()],
    });
    setNewEntityName("");
  };

  const handleRemoveEntity = (index: number) => {
    const updated = activeContext.entities?.filter((_, i) => i !== index);
    onUpdateContext({ entities: updated });
  };

  const handleAddUseCase = () => {
    if (!newUseCaseName.trim()) return;
    onUpdateContext({
      useCases: [...(activeContext.useCases || []), newUseCaseName.trim()],
    });
    setNewUseCaseName("");
  };

  const handleRemoveUseCase = (index: number) => {
    const updated = activeContext.useCases?.filter((_, i) => i !== index);
    onUpdateContext({ useCases: updated });
  };

  void _contextId;

  return (
    <div className="space-y-6">
      <div className="border-t border-border pt-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Entities</h3>

        <ul className="space-y-2">
          {activeContext.entities?.map((entity, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border border-border"
            >
              <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 text-sm">{entity}</span>
              <button
                type="button"
                onClick={() => handleRemoveEntity(i)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Remove
              </button>
            </li>
          ))}
          {(!activeContext.entities || activeContext.entities.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              No entities defined.
            </p>
          )}
        </ul>

        <div className="flex gap-2 pt-2">
          <input
            type="text"
            value={newEntityName}
            onChange={(e) => setNewEntityName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleAddEntity();
              }
            }}
            placeholder="New entity name"
            className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm"
          />
          <button
            type="button"
            onClick={handleAddEntity}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Use Cases</h3>

        <ul className="space-y-2">
          {activeContext.useCases?.map((useCase, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border border-border"
            >
              <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 text-sm">{useCase}</span>
              <button
                type="button"
                onClick={() => handleRemoveUseCase(i)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Remove
              </button>
            </li>
          ))}
          {(!activeContext.useCases || activeContext.useCases.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              No use cases defined.
            </p>
          )}
        </ul>

        <div className="flex gap-2 pt-2">
          <input
            type="text"
            value={newUseCaseName}
            onChange={(e) => setNewUseCaseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleAddUseCase();
              }
            }}
            placeholder="New use case name"
            className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm"
          />
          <button
            type="button"
            onClick={handleAddUseCase}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Quick Edit
        </h3>
        <p className="text-xs text-muted-foreground italic mb-2">
          Or edit as comma-separated values:
        </p>

        <div className="space-y-3">
          <input
            type="text"
            value={activeContext.entities?.join(", ") || ""}
            onChange={(e) => {
              const entities = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateContext({ entities });
            }}
            placeholder="User, Order, Product (comma-separated)"
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
          />
          <input
            type="text"
            value={activeContext.useCases?.join(", ") || ""}
            onChange={(e) => {
              const useCases = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateContext({ useCases });
            }}
            placeholder="RegisterUser, PlaceOrder (comma-separated)"
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
          />
        </div>
      </div>
    </div>
  );
}

export default StepDomain;
