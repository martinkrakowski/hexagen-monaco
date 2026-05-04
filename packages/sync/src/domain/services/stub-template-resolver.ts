/**
 * Template resolution service for stub generation.
 *
 * Handles the cascading resolution of template bodies and naming conventions:
 *   1. per-context naming override
 *   2. global naming override
 *   3. built-in fallback (DEFAULT_TEMPLATES / DEFAULT_NAMING)
 */

import type { StubTemplates, StubNaming } from "../../types/manifest.js";
import type { SyncConfig } from "../../config.js";
import { interpolate } from "../../template-engine.js";
import { DEFAULT_TEMPLATES, DEFAULT_NAMING } from "../stub-templates.js";
import type { StubKind } from "./emission-plan-builder.js";

export type { StubKind };

export function resolveTemplate(
  kind: StubKind,
  manifestTemplates: StubTemplates | undefined,
): string {
  return manifestTemplates?.[kind] ?? DEFAULT_TEMPLATES[kind];
}

export function resolveNaming(
  kind: StubKind,
  contextNaming: StubNaming | undefined,
  manifestNaming: StubNaming | undefined,
): string {
  return (
    contextNaming?.[kind] ?? manifestNaming?.[kind] ?? DEFAULT_NAMING[kind]
  );
}

export function interpolateWithLog(
  template: string,
  name: string,
  templateId: string,
  config: SyncConfig,
): string {
  const { output, warnings } = interpolate(template, { name });
  if (warnings.length > 0) {
    for (const missing of warnings) {
      config.logger.warn(`${templateId}: missing variable '${missing}'`);
    }
  }
  return output;
}
