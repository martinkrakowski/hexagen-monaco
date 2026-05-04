/**
 * Emission plan builder for stub generation.
 *
 * Flattens the bounded context's layers object into an ordered list of
 * emission items (kind, subdir, names) so the generator can iterate
 * them uniformly.
 */

import type { BoundedContext } from "../../types/manifest.js";

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
  subdir: EmissionSite;
  names: string[];
}

interface DomainLayerWithServices {
  entities?: string[];
  value_objects?: string[];
  ports?: {
    in?: string[];
    out?: string[];
  };
  domain_services?: string[];
}

interface LayersWithDomainServices {
  domain?: DomainLayerWithServices;
  application?: {
    use_cases?: string[];
    ports?: {
      in?: string[];
      out?: string[];
    };
  };
  infrastructure?: {
    adapters?: string[];
  };
}

export function buildEmissionPlan(context: BoundedContext): EmissionPlan[] {
  const layers = context.layers as LayersWithDomainServices | undefined;
  if (!layers) return [];

  const plan: EmissionPlan[] = [];

  const domain = layers.domain;
  if (domain) {
    if (domain.entities?.length) {
      plan.push({
        kind: "entity",
        subdir: "domain/entities",
        names: domain.entities,
      });
    }
    if (domain.value_objects?.length) {
      plan.push({
        kind: "valueObject",
        subdir: "domain/value-objects",
        names: domain.value_objects,
      });
    }
    if (domain.domain_services?.length) {
      plan.push({
        kind: "domainService",
        subdir: "domain/services",
        names: domain.domain_services,
      });
    }
    if (domain.ports?.in?.length) {
      plan.push({
        kind: "inPort",
        subdir: "domain/ports/in",
        names: domain.ports.in,
      });
    }
    if (domain.ports?.out?.length) {
      plan.push({
        kind: "outPort",
        subdir: "domain/ports/out",
        names: domain.ports.out,
      });
    }
  }

  const application = layers.application;
  if (application) {
    if (application.use_cases?.length) {
      plan.push({
        kind: "useCase",
        subdir: "application/use-cases",
        names: application.use_cases,
      });
    }
    if (application.ports?.in?.length) {
      plan.push({
        kind: "inPort",
        subdir: "application/ports/in",
        names: application.ports.in,
      });
    }
    if (application.ports?.out?.length) {
      plan.push({
        kind: "outPort",
        subdir: "application/ports/out",
        names: application.ports.out,
      });
    }
  }

  const infrastructure = layers.infrastructure;
  if (infrastructure?.adapters?.length) {
    plan.push({
      kind: "adapter",
      subdir: "infrastructure/adapters",
      names: infrastructure.adapters,
    });
  }

  return plan;
}
