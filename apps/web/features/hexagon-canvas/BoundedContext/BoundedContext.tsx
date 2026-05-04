"use client";

import { memo } from "react";
import { useBoundedContextModal } from "./hooks";
import { HexagonBoundedContext } from "./HexagonBoundedContext";
import { SatelliteNodeShell } from "./SatelliteNodeShell";
import { InnerNodeShell } from "./InnerNodeShell";
import type { UnifiedBoundedContextProps, BoundedContextData } from "./types";

function UnifiedBoundedContextComponent({
  data,
  selected = false,
}: UnifiedBoundedContextProps) {
  const { activeCompass, openCompass, closeCompass } = useBoundedContextModal();

  const nodeType =
    (data.type as Exclude<BoundedContextData["type"], undefined>) ??
    "bounded-context";
  const isPeer = !!data.isPeer;
  const isHexagon = nodeType === "bounded-context" && !isPeer;

  // Inner nodes (Domain / Use Cases) — column header labels
  if (nodeType === "inner") {
    return <InnerNodeShell data={data} />;
  }

  // Satellite cards (entity, port, use-case, adapter — NOT inner)
  if (!isHexagon) {
    return <SatelliteNodeShell data={data} selected={selected} />;
  }

  // Hexagonal bounded context
  return (
    <HexagonBoundedContext
      data={data}
      selected={selected}
      activeCompass={activeCompass}
      onModalOpen={openCompass}
      onModalClose={closeCompass}
    />
  );
}

const UnifiedBoundedContext = memo(UnifiedBoundedContextComponent);

UnifiedBoundedContext.displayName = "UnifiedBoundedContext";

export { UnifiedBoundedContext };
export type { UnifiedBoundedContextProps };
