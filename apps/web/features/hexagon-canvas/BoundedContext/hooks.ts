import { useState } from "react";

interface ActiveCompass {
  label: string;
  items: string[];
}

/**
 * Manages modal state for domain compass (Aggregates, Value Objects, Events, Services)
 */
export function useBoundedContextModal() {
  const [activeCompass, setActiveCompass] = useState<ActiveCompass | null>(
    null,
  );

  const openCompass = (label: string, items: string[]) => {
    setActiveCompass({ label, items });
  };

  const closeCompass = () => {
    setActiveCompass(null);
  };

  return {
    activeCompass,
    openCompass,
    closeCompass,
  };
}
