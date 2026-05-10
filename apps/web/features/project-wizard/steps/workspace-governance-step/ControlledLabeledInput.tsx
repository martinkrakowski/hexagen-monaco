"use client";

import React from "react";
import { useController, type Control, type FieldPath } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { LabeledInput } from "./LabeledInput";

interface ControlledLabeledInputProps {
  name: FieldPath<ProjectConfig>;
  control: Control<ProjectConfig>;
  label: React.ReactNode;
  compact?: boolean;
  placeholder?: string;
}

export const ControlledLabeledInput = React.memo(function ControlledLabeledInput({
  name,
  control,
  label,
  compact,
  placeholder,
}: ControlledLabeledInputProps) {
  const { field } = useController({ name, control });

  return (
    <LabeledInput
      label={label}
      value={(field.value as string) ?? ""}
      onChange={field.onChange}
      compact={compact}
      placeholder={placeholder}
    />
  );
});
