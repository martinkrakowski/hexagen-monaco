"use client";

import React from "react";
import { useController, type Control } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

export type PackageManager = "yarn" | "pnpm" | "bun";

interface PackageManagerSelectProps {
  control: Control<ProjectConfig>;
}

export const PackageManagerSelect = React.memo(function PackageManagerSelect({
  control,
}: PackageManagerSelectProps) {
  const { field } = useController({
    name: "governance.packageManager",
    control,
  });

  const value = (field.value as PackageManager) || "yarn";

  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Package Manager
      </span>
      <select
        value={value}
        onChange={(e) => field.onChange(e.target.value as PackageManager)}
        className="w-full px-4 py-2 bg-background border border-input rounded-md"
      >
        <option value="yarn">Yarn</option>
        <option value="pnpm">PNPM</option>
        <option value="bun">Bun</option>
      </select>
    </label>
  );
});
