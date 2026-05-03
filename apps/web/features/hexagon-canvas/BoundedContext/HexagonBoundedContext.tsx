"use client";

import { HexagonNodeVisual } from "./HexagonNodeVisual";
import { HexagonLabelText } from "./HexagonLabelText";
import { DomainCompassGrid } from "./DomainCompassGrid";
import { CompassModal } from "./CompassModal";
import { HexagonHandles } from "./HexagonHandles";
import type { BoundedContextData } from "./types";
interface HexagonBoundedContextProps {
  data: BoundedContextData;
  selected: boolean;
  activeCompass: { label: string; items: string[] } | null;
  onModalOpen: (label: string, items: string[]) => void;
  onModalClose: () => void;
}

export function HexagonBoundedContext({
  data,
  selected,
  activeCompass,
  onModalOpen,
  onModalClose,
}: HexagonBoundedContextProps) {
  const dimension = 500;
  const structuralHandle =
    data.variant?.structuralHandleColor ?? data.variant?.handleColor ?? "";
  const publishedHandle =
    data.variant?.publishedEventHandleColor ?? data.variant?.handleColor ?? "";
  const subscribedHandle =
    data.variant?.subscribedEventHandleColor ?? data.variant?.handleColor ?? "";

  return (
    <div
      style={{ width: dimension, height: dimension }}
      className="relative flex items-center justify-center p-2 select-none group"
    >
      <HexagonNodeVisual selected={selected} />

      <div className="z-10 flex flex-col items-center justify-center gap-3">
        <HexagonLabelText label={data.label || ""} />
        <DomainCompassGrid stats={data.stats} onModalOpen={onModalOpen} />
        {activeCompass && (
          <CompassModal
            label={activeCompass.label}
            items={activeCompass.items}
            onClose={onModalClose}
          />
        )}
      </div>

      <HexagonHandles
        data={data}
        structuralHandle={structuralHandle}
        publishedHandle={publishedHandle}
        subscribedHandle={subscribedHandle}
      />
    </div>
  );
}
