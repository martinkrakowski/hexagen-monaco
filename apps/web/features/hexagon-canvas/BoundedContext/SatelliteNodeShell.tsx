import { PortAdapterCard } from "./PortAdapterCard";
import { EntityCard } from "./EntityCard";
import type { SatelliteNodeShellProps } from "./types";

export function SatelliteNodeShell({
  data,
  selected,
}: SatelliteNodeShellProps) {
  const variant = data.variant ?? {
    headerBg: "",
    bodyBg: "",
    border: "",
    handleColor: "",
    headerText: "",
    hexColor: "",
  };

  const nodeType = data.type;

  // Port/adapter with directional handles
  if (nodeType === "port" || nodeType === "adapter") {
    return (
      <PortAdapterCard data={data} variant={variant} selected={selected} />
    );
  }

  // Generic entity/use-case card
  return <EntityCard data={data} variant={variant} selected={selected} />;
}
