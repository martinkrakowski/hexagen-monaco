"use client";

import { useState } from "react";
import type { ExternalContext, ContextUpdateCallback } from "@hexagen/shared";
import { relationshipTypeOptions } from "./config";

interface PeerContextItemProps {
  context: ExternalContext;
  index: number;
  onUpdateContext: ContextUpdateCallback;
  onRemoveContext: () => void;
}

export function PeerContextItem({
  context,
  index,
  onUpdateContext,
  onRemoveContext,
}: PeerContextItemProps) {
  const [newEntityName, setNewEntityName] = useState("");
  const [newUseCaseName, setNewUseCaseName] = useState("");

  const handleAddEntity = () => {
    if (!newEntityName.trim()) return;
    onUpdateContext(context.id, {
      entityNames: [...(context.entityNames || []), newEntityName.trim()],
    });
    setNewEntityName("");
  };

  const handleRemoveEntity = (entityIndex: number) => {
    const updated = context.entityNames?.filter((_, i) => i !== entityIndex);
    onUpdateContext(context.id, { entityNames: updated });
  };

  const handleAddUseCase = () => {
    if (!newUseCaseName.trim()) return;
    onUpdateContext(context.id, {
      useCaseNames: [...(context.useCaseNames || []), newUseCaseName.trim()],
    });
    setNewUseCaseName("");
  };

  const handleRemoveUseCase = (useCaseIndex: number) => {
    const updated = context.useCaseNames?.filter((_, i) => i !== useCaseIndex);
    onUpdateContext(context.id, { useCaseNames: updated });
  };

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-card">
      {/* Peer Context Name Input */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
          {index + 1}.
        </span>
        <input
          value={context.name || ""}
          onChange={(e) =>
            onUpdateContext(context.id, { name: e.target.value })
          }
          className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm font-medium"
          placeholder="Peer context name (required)"
        />
      </div>

      {/* Relationship Type Selector */}
      <div className="border-t pt-4 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Relationship Type
        </h4>
        <select
          value={context.relationshipType || "U"}
          onChange={(e) => {
            onUpdateContext(context.id, {
              relationshipType: e.target
                .value as ExternalContext["relationshipType"],
            });
          }}
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
        >
          {relationshipTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* External Entities Section */}
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          External Entities
        </h4>

        <ul className="space-y-2">
          {context.entityNames?.map((entity, i) => (
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
          {(!context.entityNames || context.entityNames.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              No external entities defined.
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
            placeholder="New external entity name"
            className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm"
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

      {/* External Use Cases Section */}
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          External Use Cases
        </h4>

        <ul className="space-y-2">
          {context.useCaseNames?.map((useCase, i) => (
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
          {(!context.useCaseNames || context.useCaseNames.length === 0) && (
            <p className="text-xs text-muted-foreground italic">
              No external use cases defined.
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
            placeholder="New external use case name"
            className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm"
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
            value={context.entityNames?.join(", ") || ""}
            onChange={(e) => {
              const entityNames = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateContext(context.id, { entityNames });
            }}
            placeholder="User, Order (comma-separated)"
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
          />
          <input
            type="text"
            value={context.useCaseNames?.join(", ") || ""}
            onChange={(e) => {
              const useCaseNames = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateContext(context.id, { useCaseNames });
            }}
            placeholder="RegisterUser, PlaceOrder (comma-separated)"
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm"
          />
        </div>
      </div>

      {/* Remove Peer Context Button */}
      <button
        type="button"
        onClick={onRemoveContext}
        disabled={
          context.entityNames?.length === 0 &&
          context.useCaseNames?.length === 0
        }
        className="w-full py-2 text-sm text-destructive hover:text-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-t"
      >
        Remove Peer Context
      </button>
    </div>
  );
}

export default PeerContextItem;
