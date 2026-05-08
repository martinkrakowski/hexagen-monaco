"use client";

import type {
  CreationPathOption,
  CreationPathId,
} from "../domain/creation-path";
import { CreationPathCard } from "./CreationPathCard";

interface CreationPathGridProps {
  readonly options: readonly CreationPathOption[];
  readonly onSelectPath: (id: CreationPathId) => void;
}

export function CreationPathGrid({
  options,
  onSelectPath,
}: CreationPathGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in-up delay-200">
      {options.map((option) => (
        <CreationPathCard
          key={option.id}
          option={option}
          onSelect={onSelectPath}
          colorTheme={option.colorTheme}
        />
      ))}
    </div>
  );
}
