"use client";

import { useFormContext } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import {
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
  const { register, watch } = useFormContext<ProjectConfig>();
  const isImported = watch("manifestSource") === "imported";

  return (
    <div className="space-y-3">
      {/*
        UI Frontend + API Backend are NOT per-context — they are a single
        project-level choice on the Applications step (ADR-0041). Only the
        domain-owned driven infra (persistence / messaging / telemetry) lives
        here.
      */}
      {isImported ? (
        /*
          Imported projects: persistence/messaging come from the manifest's
          adapters, which these pickers can neither represent nor edit — the
          wizard fields would silently diverge from the source of truth
          (import round-trip integrity, Item 1.4). Telemetry stays editable
          below: it has no manifest home, so the wizard field IS its source
          of truth.
        */
        <div
          role="status"
          className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
        >
          Persistence and messaging are managed by the imported manifest and
          can&apos;t be edited here.
        </div>
      ) : (
        <>
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>Persistence</span>
            <select
              {...register(
                `${fieldPrefix}.persistenceAdapter` as FieldPath<ProjectConfig>,
              )}
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
              {...register(
                `${fieldPrefix}.messagingAdapter` as FieldPath<ProjectConfig>,
              )}
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
        </>
      )}

      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>Telemetry</span>
        <select
          {...register(
            `${fieldPrefix}.telemetryProvider` as FieldPath<ProjectConfig>,
          )}
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
