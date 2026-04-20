import type { WizardData } from "@hexagen/shared";
import type { ProjectConfig } from "@hexagen/project-configuration";

/**
 * Boundary transformer: converts the form-shape `ProjectConfig` (from
 * `@hexagen/project-configuration`) into the domain-shape `WizardData`
 * (from `@hexagen/shared`).
 *
 * The two schemas intentionally diverge — the form allows partial/empty
 * values during wizard input (`"" | "Next.js" | ...`), while the domain
 * type declares strict values. Downstream consumers (`wizardToManifest`,
 * canvas) already tolerate missing fields with `?? default` fallbacks,
 * so structural coercion is safe here. The cast is isolated to this
 * single boundary function rather than scattered across call sites.
 */
export function buildWizardData(
  boundedContexts: ProjectConfig["boundedContexts"],
  externalContexts: ProjectConfig["externalContexts"],
  peerMappings: ProjectConfig["peerMappings"],
  governance: ProjectConfig["governance"],
): WizardData {
  return {
    boundedContexts:
      boundedContexts as unknown as WizardData["boundedContexts"],
    externalContexts:
      externalContexts as unknown as WizardData["externalContexts"],
    peerMappings: peerMappings as unknown as WizardData["peerMappings"],
    governance,
  };
}
