/**
 * Template resolution service for stub generation.
 *
 * Handles the cascading resolution of template bodies and naming conventions:
 *   1. per-context naming override
 *   2. global naming override
 *   3. built-in fallback (DEFAULT_TEMPLATES / DEFAULT_NAMING)
 */

import type { StubTemplates, StubNaming } from "../../types/manifest.js";
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

/**
 * Everything this service needs from the outside world, declared BY the domain
 * so the domain owns the contract (HEX-038).
 *
 * This module used to take the whole `SyncConfig` and reach into it for two
 * values, which pointed the dependency arrow from the innermost layer straight
 * at the composition root — `SyncConfig` carries CLI flags, the workspace root,
 * the live logger and the mutation journal, none of which stub interpolation
 * has any business knowing about. Being `import type` made it invisible at
 * runtime but no less of a compile-time layer dependency.
 *
 * The narrow slice is two values. `scope` is deliberately the already-resolved
 * string rather than the `Manifest` it comes from: the projection is
 * `resolveScope(config.manifest)`, which is exactly what `apps`, `tsconfig`,
 * `package-json` and `root-files` already do at their own call sites, so
 * resolving it in the generator makes stub emission consistent with its four
 * siblings instead of being the one place that re-derives it per file.
 */
export interface StubInterpolationContext {
  /**
   * The generated project's own npm scope, without the `@`. Lets stub bodies
   * reference the project's packages (`@{scope}/shared`) rather than the
   * generator's `@hexagen/*` namespace.
   */
  readonly scope: string;
  /**
   * Where an unresolved-variable warning goes. A one-method sink, not a
   * logger: `LoggerPort` satisfies it structurally, and so does a test spy or
   * an array push, without the domain importing a logging abstraction.
   */
  readonly warn: (message: string) => void;
}

export function interpolateWithLog(
  template: string,
  name: string,
  templateId: string,
  context: StubInterpolationContext,
): string {
  const { output, warnings } = interpolate(template, {
    name,
    scope: context.scope,
  });
  if (warnings.length > 0) {
    for (const missing of warnings) {
      context.warn(`${templateId}: missing variable '${missing}'`);
    }
  }
  return output;
}
