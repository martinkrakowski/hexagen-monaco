/**
 * Slice-agnostic option lists for the project-configuration form fields.
 *
 * These are presentation vocabularies over `@hexagen/project-configuration`
 * field values — the wizard renders them, but so do the landing project list
 * (label lookup) and the genesis workbench. They lived in
 * `features/project-wizard/config.ts` and were therefore reachable from other
 * slices only through an `@/project-wizard/config` alias import, i.e. a
 * cross-slice coupling the boundary gate had to pin. They are not
 * wizard-specific, so they live in a neutral home instead; the genuinely
 * wizard-specific `wizardSteps` / `stepIndexById` stay in the slice.
 *
 * This module must not import from `features/` — that would invert the
 * dependency it exists to remove.
 */

export const persistenceAdapterOptions = [
  "Prisma",
  "TypeORM",
  "Mongoose",
  "Drizzle",
] as const;

export const messagingAdapterOptions = [
  "BullMQ",
  "Temporal",
  "RabbitMQ",
] as const;

export const telemetryProviderOptions = [
  "None",
  "OpenTelemetry",
  "Prometheus",
  "Winston",
] as const;

export const apiFrameworkOptions = [
  { value: "nitro", label: "Nitro" },
  { value: "nestjs", label: "NestJS" },
  { value: "express", label: "Express" },
  { value: "serverless", label: "Serverless" },
  { value: "plain-ts", label: "Plain TypeScript" },
  // No separate API backend (UI-only). deriveApps emits no `api` app.
  { value: "none", label: "None (No API backend)" },
] as const;

export const uiFrameworkOptions = [
  { value: "", label: "None (Headless / API Only)" },
  { value: "Next.js", label: "Next.js" },
  { value: "Remix", label: "Remix" },
  { value: "React Router", label: "React Router" },
  { value: "Vue.js", label: "Vue.js" },
  { value: "Angular", label: "Angular" },
] as const;

export const relationshipTypeOptions = [
  { value: "U", label: "Upstream" },
  { value: "D", label: "Downstream" },
  { value: "ACL", label: "Anticorruption Layer" },
  { value: "SK", label: "Shared Kernel" },
  { value: "P", label: "Partnership" },
  { value: "OHS", label: "Open Host Service" },
] as const;
