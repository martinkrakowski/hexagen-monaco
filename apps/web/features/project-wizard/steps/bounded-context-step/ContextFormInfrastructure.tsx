"use client";

import { useFormContext } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import {
  apiFrameworkOptions,
  uiFrameworkOptions,
  persistenceAdapterOptions,
  messagingAdapterOptions,
  telemetryProviderOptions,
} from "@/project-wizard/config";

interface ContextFormInfrastructureProps {
  fieldPrefix: string;
}

const FIELD_LABEL_CLASSES =
  "block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5";
const SELECT_CLASSES =
  "w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none";

export function ContextFormInfrastructure({
  fieldPrefix,
}: ContextFormInfrastructureProps) {
  const { register } = useFormContext<ProjectConfig>();

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>API Backend</span>
        <select
          {...register(`${fieldPrefix}.infrastructureTarget` as FieldPath<ProjectConfig>)}
          className={SELECT_CLASSES}
        >
          <option value="" disabled>
            Select Backend
          </option>
          {apiFrameworkOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>UI Frontend</span>
        <select
          {...register(`${fieldPrefix}.uiFramework` as FieldPath<ProjectConfig>)}
          className={SELECT_CLASSES}
        >
          {uiFrameworkOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>Persistence</span>
        <select
          {...register(`${fieldPrefix}.persistenceAdapter` as FieldPath<ProjectConfig>)}
          className={SELECT_CLASSES}
        >
          <option value="">None</option>
          {persistenceAdapterOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>Messaging</span>
        <select
          {...register(`${fieldPrefix}.messagingAdapter` as FieldPath<ProjectConfig>)}
          className={SELECT_CLASSES}
        >
          <option value="">None</option>
          {messagingAdapterOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>Telemetry</span>
        <select
          {...register(`${fieldPrefix}.telemetryProvider` as FieldPath<ProjectConfig>)}
          className={SELECT_CLASSES}
        >
          {telemetryProviderOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
