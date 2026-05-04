"use client";

import { m, useReducedMotion } from "framer-motion";
import { AttrRow } from "./AttrRow";
import type { ModelAttributesSectionProps } from "./types";

export function ModelAttributesSection({ model }: ModelAttributesSectionProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <m.div
      className="px-5 pb-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={
        shouldReduceMotion ? { duration: 0 } : { duration: 0.3, delay: 0.2 }
      }
    >
      <div className="bg-muted/50 dark:bg-muted border border-border rounded-sm px-4 py-0.5">
        {model.parameterSize && (
          <AttrRow
            label="Parameters"
            value={model.parameterSize}
            delay={0.24}
          />
        )}
        {model.contextLength && (
          <AttrRow
            label="Context Window"
            value={`${model.contextLength.toLocaleString()} tokens`}
            delay={0.28}
          />
        )}
        {model.quantizeLevel && (
          <AttrRow
            label="Quantization"
            value={model.quantizeLevel}
            delay={0.32}
          />
        )}
      </div>
    </m.div>
  );
}
