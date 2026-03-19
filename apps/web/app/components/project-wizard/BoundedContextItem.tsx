"use client";

import { useState } from "react";
import type { BoundedContextInput } from "@hexagen/project-configuration";
import type { ContextUpdateCallback } from "@hexagen/shared";

interface BoundedContextItemProps {
  context: BoundedContextInput;
  index: number;
  onUpdateContext: ContextUpdateCallback;
  onRemoveContext: () => void;
  canRemove: boolean;
}

export function BoundedContextItem({
  context,
  index,
  onUpdateContext,
  onRemoveContext,
  canRemove,
}: BoundedContextItemProps) {
  const [newEntityName, setNewEntityName] = useState("");
  const [newUseCaseName, setNewUseCaseName] = useState("");

  const handleAddEntity = () => {
    if (!newEntityName.trim() || !context.id) return;
    onUpdateContext(context.id, {
      entities: [...(context.entities || []), newEntityName.trim()],
    });
    setNewEntityName("");
  };

  const handleRemoveEntity = (entityIndex: number) => {
    if (!context.id) return;
    const updated = context.entities?.filter((_, i) => i !== entityIndex);
    onUpdateContext(context.id, { entities: updated });
  };

  const handleAddUseCase = () => {
    if (!newUseCaseName.trim() || !context.id) return;
    onUpdateContext(context.id, {
      useCases: [...(context.useCases || []), newUseCaseName.trim()],
    });
    setNewUseCaseName("");
  };

  const handleRemoveUseCase = (useCaseIndex: number) => {
    if (!context.id) return;
    const updated = context.useCases?.filter((_, i) => i !== useCaseIndex);
    onUpdateContext(context.id, { useCases: updated });
  };

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-card">
      {/* Context Name Input */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
          {index + 1}.
        </span>
        <input
          value={context.name || ""}
          onChange={(e) => context.id && onUpdateContext(context.id, { name: e.target.value })}
          className="flex-1 px-3 py-2 border rounded-md text-sm font-medium"
          placeholder="Context name (required)"
        />
      </div>

      {/* Entities Section */}
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Entities
        </h4>

        <ul className="space-y-2">
          {context.entities?.map((entity, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border"
            >
              <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                •
              </span>
              <span className="flex-1 text-sm">{entity}</span>
              <button
                type="button"
                onClick={() => handleRemoveEntity(i)}
                className="text-xs px-2 py-1 bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Remove entity ${entity}`}
              >
                ✕
              </button>
            </li>
          ))}
          {(!context.entities || context.entities.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              No entities defined.
            </p>
          )}
        </ul>

        {/* Add Entity */}
        <div className="flex gap-2">
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
            className="flex-1 px-3 py-2 border rounded-md text-sm"
          />
          <button
            type="button"
            onClick={handleAddEntity}
            disabled={!newEntityName.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Entity
          </button>
        </div>
      </div>

      {/* Use Cases Section */}
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Use Cases
        </h4>

        <ul className="space-y-2">
          {context.useCases?.map((useCase, i) => (
            <li
              key={i}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border"
            >
              <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                •
              </span>
              <span className="flex-1 text-sm">{useCase}</span>
              <button
                type="button"
                onClick={() => handleRemoveUseCase(i)}
                className="text-xs px-2 py-1 bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors"
                aria-label={`Remove use case ${useCase}`}
              >
                ✕
              </button>
            </li>
          ))}
          {(!context.useCases || context.useCases.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              No use cases defined.
            </p>
          )}
        </ul>

        {/* Add Use Case */}
        <div className="flex gap-2">
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
            className="flex-1 px-3 py-2 border rounded-md text-sm"
          />
          <button
            type="button"
            onClick={handleAddUseCase}
            disabled={!newUseCaseName.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Use Case
          </button>
        </div>
      </div>

      {/* Quick Edit Section */}
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Quick Edit
        </h4>
        <p className="text-xs text-muted-foreground italic mb-1">
          Or edit as comma-separated values:
        </p>

        <div className="space-y-2">
          <input
            type="text"
            value={context.entities?.join(", ") || ""}
            onChange={(e) => {
              if (!context.id) return;
              const entities = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateContext(context.id, { entities });
            }}
            placeholder="User, Order, Product (comma-separated)"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
          <input
            type="text"
            value={context.useCases?.join(", ") || ""}
            onChange={(e) => {
              if (!context.id) return;
              const useCases = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateContext(context.id, { useCases });
            }}
            placeholder="RegisterUser, PlaceOrder (comma-separated)"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
      </div>

      {/* Remove Context Button */}
      {canRemove && (
        <button
          type="button"
          onClick={onRemoveContext}
          disabled={context.entities?.length === 0 && context.useCases?.length === 0}
          className="w-full py-2 text-sm text-destructive hover:text-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-t"
        >
          Remove Context
        </button>
      )}
    </div>
  );
}

export default BoundedContextItem;
