"use client";

import { useEffect, useRef, useCallback, type RefObject } from "react";

export interface UseFocusTrapOptions {
  isActive: boolean;
  containerRef: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
}

export interface UseFocusTrapReturn {
  focusTrapProps: {
    onKeyDown: (e: KeyboardEvent) => void;
  };
}

export function useFocusTrap({
  isActive,
  containerRef,
  restoreFocus = true,
}: UseFocusTrapOptions): UseFocusTrapReturn {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    if (restoreFocus) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }

    const focusableElements = containerRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    if (focusableElements && focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }

    return () => {
      if (restoreFocus && previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [isActive, containerRef, restoreFocus]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive || !containerRef.current) return;

      if (e.key === "Tab") {
        const focusableElements = containerRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    },
    [isActive, containerRef],
  );

  return {
    focusTrapProps: {
      onKeyDown: handleKeyDown,
    },
  };
}
