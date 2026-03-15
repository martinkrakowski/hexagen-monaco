"use client";

import { useState, useEffect } from "react";
import type { HexagonNode, HexagonNodeType } from "@hexagen/visualization";

const NODE_TYPES: HexagonNodeType[] = [
  "bounded-context",
  "entity",
  "port",
  "use-case",
];

interface NodeEditorDialogProps {
  isOpen: boolean;
  node?: HexagonNode;
  onClose: () => void;
  onUpdateNode: (
    nodeId: string,
    updates: Pick<HexagonNode, "label" | "type">,
  ) => void;
}

export function NodeEditorDialog({
  isOpen,
  node,
  onClose,
  onUpdateNode,
}: NodeEditorDialogProps) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<HexagonNodeType>("entity");

  useEffect(() => {
    if (node) {
      setLabel(node.label);
      setType(node.type);
    }
  }, [node]);

  if (!isOpen || !node) {
    return null;
  }

  const handleSave = () => {
    onUpdateNode(node.id, { label, type });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      role="dialog"
    >
      <div
        className="bg-background rounded-lg shadow-lg p-6 w-[400px] border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">Edit Node</h2>

        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              htmlFor="node-type"
            >
              Type
            </label>
            <select
              id="node-type"
              value={type}
              onChange={(e) => setType(e.target.value as HexagonNodeType)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {NODE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("-", " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              htmlFor="node-label"
            >
              Label
            </label>
            <input
              id="node-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md border border-input hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
