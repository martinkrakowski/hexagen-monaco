"use client";

import { useState } from "react";
import type { HexagonNode, HexagonNodeType } from "@hexagen/visualization";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

const NODE_TYPES: HexagonNodeType[] = [
  "bounded-context",
  "entity",
  "port",
  "use-case",
  "adapter",
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
  const [label, setLabel] = useState(node?.label ?? "");
  const [type, setType] = useState<HexagonNodeType>(node?.type ?? "entity");

  if (!isOpen || !node) {
    return null;
  }

  const handleSave = () => {
    onUpdateNode(node.id, { label, type });
    onClose();
  };

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Node</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
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
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <Input
              id="node-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <PrimaryButton variant="outline" onClick={onClose}>
            Cancel
          </PrimaryButton>
          <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
