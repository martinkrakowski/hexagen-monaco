"use client";

import { SectionLabel, ViolationItem } from "../governance";
import type { ViolationsSectionProps } from "./types";

export function ViolationsSection({
  violations,
  activeItem,
  onSelectViolation,
}: ViolationsSectionProps) {
  return (
    <div className="mt-5">
      <SectionLabel label="Violations" />
      {violations.length > 0 && (
        <div className="space-y-2 mt-4">
          {violations.map((v) => (
            <ViolationItem
              key={v.id}
              violation={v}
              isSelected={
                activeItem?.type === "violation" && activeItem.item.id === v.id
              }
              onSelect={() => onSelectViolation(v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
