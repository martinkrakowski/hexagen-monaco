"use client";

import React from "react";
import type { Control } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { ControlledLabeledInput } from "./ControlledLabeledInput";

interface NamingConventionsFieldsetProps {
  control: Control<ProjectConfig>;
}

export const NamingConventionsFieldset = React.memo(
  function NamingConventionsFieldset({
    control,
  }: NamingConventionsFieldsetProps) {
    return (
      <div className="p-0">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Naming Conventions
        </h3>
        <div className="space-y-3">
          <ControlledLabeledInput
            name="governance.namingConventions.contextDirectoryPattern"
            control={control}
            compact
            label="Context Directory Pattern"
            placeholder="packages/"
          />
          <ControlledLabeledInput
            name="governance.namingConventions.adapterSuffix"
            control={control}
            compact
            label="Adapter Suffix"
            placeholder=".adapter.ts"
          />
        </div>
      </div>
    );
  },
);
