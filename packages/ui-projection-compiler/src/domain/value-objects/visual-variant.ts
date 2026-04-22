import { NodeKind } from "@hexagen/core-domain";

export type VisualVariantCategory =
  | "driving"
  | "driven"
  | "presentation"
  | "infrastructure"
  | "entity"
  | "value-object"
  | "port"
  | "use-case"
  | "adapter"
  | "domain-event"
  | "policy"
  | "aggregate"
  | "service"
  | "default";

export interface VisualVariant {
  readonly category: VisualVariantCategory;
  readonly headerBg: string;
  readonly bodyBg: string;
  readonly border: string;
  readonly handleColor: string;
  readonly headerText: string;
  readonly hexColor: string;
}

export function categoryFromNodeKind(kind: NodeKind): VisualVariantCategory {
  switch (kind) {
    case NodeKind.BoundedContext:
      return "default";
    case NodeKind.Entity:
    case NodeKind.Aggregate:
      return "entity";
    case NodeKind.ValueObject:
      return "value-object";
    case NodeKind.Port:
      return "port";
    case NodeKind.UseCase:
    case NodeKind.Service:
      return "use-case";
    case NodeKind.Adapter:
    case NodeKind.Repository:
    case NodeKind.Factory:
    case NodeKind.PersistenceAdapter:
    case NodeKind.MessagingAdapter:
    case NodeKind.ExternalIntegrationAdapter:
      return "adapter";
    case NodeKind.DomainEvent:
      return "domain-event";
    case NodeKind.Policy:
      return "policy";
    case NodeKind.Controller:
    case NodeKind.Presenter:
      return "presentation";
    case NodeKind.Gateway:
    case NodeKind.Driver:
      return "driving";
    case NodeKind.Extension:
      return "default";
    default:
      return "default";
  }
}

export function categoryFromSideAndLabel(
  side: "north" | "south" | "east" | "west" | undefined,
  label: string,
): VisualVariantCategory {
  if (side === "north") return "driving";
  if (side === "south") return "infrastructure";
  if (side === "west") return "driving";
  if (side === "east") return "driven";
  const lower = label.toLowerCase();
  if (lower.includes("controller") || lower.includes("presenter"))
    return "presentation";
  if (lower.includes("repository") || lower.includes("persistence"))
    return "infrastructure";
  if (lower.includes("gateway") || lower.includes("driver")) return "driving";
  return "port";
}
