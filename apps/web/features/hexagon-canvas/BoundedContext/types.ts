import type { DomainEventRef } from "@hexagen/project-configuration";
import type { VisualVariantCategory } from "@hexagen/ui-projection-compiler";

export interface NodeStats {
  aggregates?: number;
  aggregateItems?: string[];
  valueObjects?: number;
  valueObjectItems?: string[];
  events?: number;
  eventItems?: string[];
  services?: number;
  serviceItems?: string[];
}

export interface NodeVariant {
  headerBg: string;
  bodyBg: string;
  border: string;
  handleColor: string;
  headerText: string;
  hexColor: string;
  structuralHandleColor?: string;
  publishedEventHandleColor?: string;
  subscribedEventHandleColor?: string;
}

export interface BoundedContextData extends Record<string, unknown> {
  label: string;
  type?:
    | "bounded-context"
    | "entity"
    | "port"
    | "use-case"
    | "adapter"
    | "inner";
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  compilerCategory?: VisualVariantCategory;
  variant?: NodeVariant;
  stats?: NodeStats;
  publishedEvents?: DomainEventRef[];
  subscribedEvents?: DomainEventRef[];
  parentId?: string;
}

export interface UnifiedBoundedContextProps {
  data: BoundedContextData;
  selected?: boolean;
}

export interface CompassModalProps {
  label: string;
  items: string[];
  onClose: () => void;
}

export interface HexagonNodeVisualProps {
  selected: boolean;
}

export interface DomainCompassGridProps {
  stats?: NodeStats;
  onModalOpen: (label: string, items: string[]) => void;
}

export interface SatelliteNodeShellProps {
  data: BoundedContextData;
  selected: boolean;
}

export interface InnerNodeShellProps {
  data: BoundedContextData;
}
