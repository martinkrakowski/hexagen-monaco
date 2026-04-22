"use client";

import type { BoundedContext } from "@hexagen/project-configuration";

import {
  apiFrameworkOptions,
  uiFrameworkOptions,
  persistenceAdapterOptions,
  messagingAdapterOptions,
  telemetryProviderOptions,
} from "@/project-wizard/config";

interface ContextFormInfrastructureProps {
  context: BoundedContext;
  onUpdate: (updater: (ctx: BoundedContext) => BoundedContext) => void;
}

const FIELD_LABEL_CLASSES =
  "block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5";
const SELECT_CLASSES =
  "w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none";

/**
 * Infrastructure choices for a bounded context: API backend, UI
 * frontend, persistence, messaging, telemetry. Five independent
 * single-select fields driven by config-provided option lists.
 *
 * The enum narrowings (`as BoundedContext["xxx"]`) are isolated to
 * this boundary where native `<select>` produces a wider `string`
 * than the ProjectConfig schema accepts.
 */
export function ContextFormInfrastructure({
  context,
  onUpdate,
}: ContextFormInfrastructureProps) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={FIELD_LABEL_CLASSES}>API Backend</span>
        <select
          value={context.infrastructureTarget || ""}
          onChange={(e) =>
            onUpdate((ctx) => ({
              ...ctx,
              infrastructureTarget: e.target
                .value as BoundedContext["infrastructureTarget"],
            }))
          }
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
          value={context.uiFramework || ""}
          onChange={(e) =>
            onUpdate((ctx) => ({
              ...ctx,
              uiFramework: e.target.value as BoundedContext["uiFramework"],
            }))
          }
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
          value={context.persistenceAdapter || ""}
          onChange={(e) =>
            onUpdate((ctx) => ({
              ...ctx,
              persistenceAdapter: e.target
                .value as BoundedContext["persistenceAdapter"],
            }))
          }
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
          value={context.messagingAdapter || ""}
          onChange={(e) =>
            onUpdate((ctx) => ({
              ...ctx,
              messagingAdapter: e.target
                .value as BoundedContext["messagingAdapter"],
            }))
          }
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
          value={context.telemetryProvider || "None"}
          onChange={(e) =>
            onUpdate((ctx) => ({
              ...ctx,
              telemetryProvider: e.target
                .value as BoundedContext["telemetryProvider"],
            }))
          }
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
