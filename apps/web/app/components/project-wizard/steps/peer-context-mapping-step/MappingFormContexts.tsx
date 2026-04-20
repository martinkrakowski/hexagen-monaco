"use client";

import type { PeerContextMapping } from "@hexagen/project-configuration";

interface ContextOption {
  id: string;
  name: string;
}

interface MappingFormContextsProps {
  mapping: PeerContextMapping;
  contextOptions: ContextOption[];
  onUpdate: (updates: Partial<PeerContextMapping>) => void;
}

const FIELD_LABEL_CLASSES =
  "block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1";
const SELECT_CLASSES =
  "w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none";

/**
 * Consumer/Provider context selects. Both dropdowns source their
 * options from the current bounded-context list (contextOptions).
 */
export function MappingFormContexts({
  mapping,
  contextOptions,
  onUpdate,
}: MappingFormContextsProps) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>Consumer Context (Source)</span>
        <select
          value={mapping.consumerContext || ""}
          onChange={(e) => onUpdate({ consumerContext: e.target.value })}
          className={SELECT_CLASSES}
        >
          <option value="" disabled>
            Select Consumer
          </option>
          {contextOptions.map((ctx) => (
            <option key={ctx.id} value={ctx.id}>
              {ctx.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>Provider Context (Target)</span>
        <select
          value={mapping.providerContext || ""}
          onChange={(e) => onUpdate({ providerContext: e.target.value })}
          className={SELECT_CLASSES}
        >
          <option value="" disabled>
            Select Provider
          </option>
          {contextOptions.map((ctx) => (
            <option key={ctx.id} value={ctx.id}>
              {ctx.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
