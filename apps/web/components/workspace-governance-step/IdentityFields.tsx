"use client";

import React from "react";
import type { Control } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { ControlledLabeledInput } from "./ControlledLabeledInput";

interface IdentityFieldsProps {
  control: Control<ProjectConfig>;
}

export const IdentityFields = React.memo(function IdentityFields({
  control,
}: IdentityFieldsProps) {
  return (
    <>
      <ControlledLabeledInput
        name="governance.workspaceName"
        control={control}
        label="Workspace Name"
        placeholder="@mycompany"
      />

      <ControlledLabeledInput
        name="governance.workspaceDescription"
        control={control}
        label={
          <>
            Description{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </>
        }
        placeholder="Core enterprise platform monorepo"
      />

      <ControlledLabeledInput
        name="governance.namespacePrefix"
        control={control}
        label="Namespace Prefix"
        placeholder="@hexagen"
      />
    </>
  );
});
