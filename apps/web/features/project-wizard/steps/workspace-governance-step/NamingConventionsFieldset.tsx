"use client";

import { LabeledInput } from "./LabeledInput";

interface NamingConventionsFieldsetProps {
  contextDirectoryPattern: string;
  adapterSuffix: string;
  onChangeContextDirectoryPattern: (value: string) => void;
  onChangeAdapterSuffix: (value: string) => void;
}

/**
 * Sub-fieldset for code-generation naming conventions. Two inputs
 * under a shared section heading: where bounded-context directories
 * live, and the suffix applied to generated adapter files.
 */
export function NamingConventionsFieldset({
  contextDirectoryPattern,
  adapterSuffix,
  onChangeContextDirectoryPattern,
  onChangeAdapterSuffix,
}: NamingConventionsFieldsetProps) {
  return (
    <div className="p-0">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
        Naming Conventions
      </h3>
      <div className="space-y-3">
        <LabeledInput
          compact
          label="Context Directory Pattern"
          value={contextDirectoryPattern}
          onChange={onChangeContextDirectoryPattern}
          placeholder="packages/"
        />
        <LabeledInput
          compact
          label="Adapter Suffix"
          value={adapterSuffix}
          onChange={onChangeAdapterSuffix}
          placeholder=".adapter.ts"
        />
      </div>
    </div>
  );
}
