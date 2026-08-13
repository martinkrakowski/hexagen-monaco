/**
 * Emission plan builder for stub generation.
 *
 * Flattens the bounded context's layers object into an ordered list of
 * emission items (kind, subdir, names) so the generator can iterate
 * them uniformly. Directories are resolved through the single layer-folder
 * resolver (A2): each conventional emission site is combined with the
 * manifest's `generator.sync.layers` configuration, so a custom
 * `application.folder` (or an underscored `value_objects` subfolder — F16)
 * places stubs in the same tree `ensureLayerFolders` scaffolds.
 */

import type { BoundedContext } from "../../types/manifest.js";
import { portName } from "../../types/manifest.js";
import { resolveEmissionDir, type LayersConfig } from "./layer-dir-resolver.js";

/**
 * Conventional emission-site vocabulary (layer + kebab-case site). These are
 * the resolver INPUTS — the plan's `subdir` carries the RESOLVED directory
 * (relative to the package root, `src/...` by convention).
 */
export type EmissionSite =
  | "domain/entities"
  | "domain/value-objects"
  | "domain/services"
  | "domain/ports/in"
  | "domain/ports/out"
  | "application/use-cases"
  | "application/ports/in"
  | "application/ports/out"
  | "infrastructure/adapters";

export type StubKind =
  | "inPort"
  | "outPort"
  | "adapter"
  | "useCase"
  | "entity"
  | "valueObject"
  | "domainService";

export interface EmissionPlan {
  kind: StubKind;
  /** Resolved on-disk directory relative to the package root (e.g. `src/app/ports/in`). */
  subdir: string;
  names: string[];
}

export function buildEmissionPlan(
  context: BoundedContext,
  layersConfig?: LayersConfig,
): EmissionPlan[] {
  const layers = context.layers;
  if (!layers) return [];

  const dir = (site: EmissionSite): string =>
    resolveEmissionDir(layersConfig, site);

  const plan: EmissionPlan[] = [];

  const domain = layers.domain;
  if (domain) {
    if (domain.entities?.length) {
      plan.push({
        kind: "entity",
        subdir: dir("domain/entities"),
        names: domain.entities,
      });
    }
    if (domain.value_objects?.length) {
      plan.push({
        kind: "valueObject",
        subdir: dir("domain/value-objects"),
        names: domain.value_objects,
      });
    }
    if (domain.domain_services?.length) {
      plan.push({
        kind: "domainService",
        subdir: dir("domain/services"),
        names: domain.domain_services,
      });
    }
    if (domain.ports?.in?.length) {
      plan.push({
        kind: "inPort",
        subdir: dir("domain/ports/in"),
        names: domain.ports.in,
      });
    }
    if (domain.ports?.out?.length) {
      plan.push({
        kind: "outPort",
        subdir: dir("domain/ports/out"),
        names: domain.ports.out,
      });
    }
  }

  const application = layers.application;
  if (application) {
    if (application.use_cases?.length) {
      plan.push({
        kind: "useCase",
        subdir: dir("application/use-cases"),
        names: application.use_cases,
      });
    }
    if (application.ports?.in?.length) {
      plan.push({
        kind: "inPort",
        subdir: dir("application/ports/in"),
        names: application.ports.in.map(portName),
      });
    }
    if (application.ports?.out?.length) {
      plan.push({
        kind: "outPort",
        subdir: dir("application/ports/out"),
        names: application.ports.out.map(portName),
      });
    }
  }

  const infrastructure = layers.infrastructure;
  if (infrastructure?.adapters?.length) {
    plan.push({
      kind: "adapter",
      subdir: dir("infrastructure/adapters"),
      names: infrastructure.adapters,
    });
  }

  return plan;
}
