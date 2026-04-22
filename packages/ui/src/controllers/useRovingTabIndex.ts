import { useRef, useCallback } from "react";

export interface UseRovingTabIndexOptions {
  initialIndex?: number;
  circular?: boolean;
}

export interface UseRovingTabIndexReturn {
  tabIndex: 0 | -1;
  focusNext: () => void;
  focusPrevious: () => void;
  focusAt: (index: number) => void;
}

export function useRovingTabIndex(
  options: UseRovingTabIndexOptions = {},
): UseRovingTabIndexReturn {
  const { initialIndex = 0, circular = false } = options;
  const focusedIndex = useRef(initialIndex);
  const totalItems = useRef(0);

  const clamp = useCallback(
    (index: number) => {
      if (circular) {
        return (
          ((index % totalItems.current) + totalItems.current) %
          totalItems.current
        );
      }
      return Math.max(0, Math.min(index, totalItems.current - 1));
    },
    [circular],
  );

  const focusNext = useCallback(() => {
    focusedIndex.current = clamp(focusedIndex.current + 1);
  }, [clamp]);

  const focusPrevious = useCallback(() => {
    focusedIndex.current = clamp(focusedIndex.current - 1);
  }, [clamp]);

  const focusAt = useCallback(
    (index: number) => {
      focusedIndex.current = clamp(index);
    },
    [clamp],
  );

  return {
    tabIndex: 0,
    focusNext,
    focusPrevious,
    focusAt,
  };
}
