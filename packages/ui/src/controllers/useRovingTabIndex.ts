import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Roving tabindex for a composite widget (radiogroup, toolbar, menu, tablist).
 *
 * The pattern: the whole group is ONE tab stop. Exactly one item carries
 * `tabIndex={0}`; every other item carries `-1`. Arrow keys move focus within
 * the group, and Tab leaves it entirely.
 *
 * The previous implementation could not express any of that:
 *   - `totalItems` was a ref initialised to `0` and NEVER assigned, so in
 *     circular mode `clamp` computed `x % 0` -> NaN, and in linear mode it
 *     clamped every index to `0`.
 *   - it returned a hardcoded `tabIndex: 0` and never `-1`, so it could not
 *     express roving tabindex at all.
 *   - it held no element refs, so it never focused anything.
 * It was exported from the barrel and advertised in DESIGN.md, so composing it
 * -- which DESIGN.md tells you to do before writing your own -- yielded silent
 * no-ops. Nothing consumed it, which is why the API is corrected outright
 * rather than preserved.
 */
export interface UseRovingTabIndexOptions {
  /** How many items the group renders. */
  itemCount: number;
  /** Which item starts in the tab order. Defaults to the first focusable one. */
  initialIndex?: number;
  /** Wrap past the ends instead of stopping. */
  circular?: boolean;
  /**
   * Items that cannot take focus (e.g. `disabled` options).
   *
   * Movement walks only the focusable items, so a disabled item is invisible
   * to the keyboard rather than a dead stop in the middle of the group.
   */
  disabledIndices?: readonly number[];
}

export interface UseRovingTabIndexReturn {
  /** The item currently in the tab order, or -1 when none can be focused. */
  activeIndex: number;
  /** `0` for the active item, `-1` for the rest. Spread onto each item. */
  getTabIndex: (index: number) => 0 | -1;
  /** Ref callback so the hook can actually move DOM focus. */
  setItemRef: (index: number) => (element: HTMLElement | null) => void;
  focusNext: () => void;
  focusPrevious: () => void;
  focusFirst: () => void;
  focusLast: () => void;
  focusAt: (index: number) => void;
}

export function useRovingTabIndex(
  options: UseRovingTabIndexOptions,
): UseRovingTabIndexReturn {
  const {
    itemCount,
    initialIndex = 0,
    circular = false,
    disabledIndices,
  } = options;

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const elements = useRef<Array<HTMLElement | null>>([]);

  // Keyed on the contents rather than the array identity: callers almost
  // always pass a fresh literal each render, so depending on identity would
  // rebuild every callback on every render.
  const disabledKey = disabledIndices ? disabledIndices.join(",") : "";
  const focusable = useMemo(() => {
    const skip = new Set(
      disabledKey.length > 0 ? disabledKey.split(",").map(Number) : [],
    );
    const out: number[] = [];
    for (let i = 0; i < itemCount; i += 1) if (!skip.has(i)) out.push(i);
    return out;
  }, [itemCount, disabledKey]);

  // The active item can stop being focusable -- an option becomes disabled
  // while it holds the tab stop. Falling back keeps the group reachable by
  // Tab; without this the group would silently drop out of the tab order.
  const effectiveIndex = focusable.includes(activeIndex)
    ? activeIndex
    : (focusable[0] ?? -1);

  const apply = useCallback((index: number) => {
    setActiveIndex(index);
    elements.current[index]?.focus();
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (focusable.length === 0) return;
      const position = focusable.indexOf(effectiveIndex);
      if (position < 0) {
        apply(focusable[0]);
        return;
      }
      const next = position + delta;
      const wrapped = circular
        ? (((next % focusable.length) + focusable.length) % focusable.length)
        : Math.min(focusable.length - 1, Math.max(0, next));
      apply(focusable[wrapped]);
    },
    [focusable, effectiveIndex, circular, apply],
  );

  const focusNext = useCallback(() => move(1), [move]);
  const focusPrevious = useCallback(() => move(-1), [move]);

  const focusFirst = useCallback(() => {
    if (focusable.length > 0) apply(focusable[0]);
  }, [focusable, apply]);

  const focusLast = useCallback(() => {
    if (focusable.length > 0) apply(focusable[focusable.length - 1]);
  }, [focusable, apply]);

  const focusAt = useCallback(
    (index: number) => {
      // Silently ignores a disabled or out-of-range target rather than
      // clamping to a neighbour: clamping would move focus somewhere the
      // caller did not ask for, which is harder to debug than nothing.
      if (focusable.includes(index)) apply(index);
    },
    [focusable, apply],
  );

  const getTabIndex = useCallback(
    (index: number): 0 | -1 => (index === effectiveIndex ? 0 : -1),
    [effectiveIndex],
  );

  // One STABLE callback per index, cached.
  //
  // Returning a fresh closure per call looks harmless but makes React tear
  // down and re-attach every ref in the group on every re-render -- and this
  // hook re-renders on each arrow keypress, so an N-item group paid 2N ref
  // detach/attach cycles per keystroke. Focus still worked, which is why it
  // was easy to miss; the cost lands on consumers whose ref callback does
  // real work (measurement, IntersectionObserver), silently re-running it.
  const refCallbacks = useRef(
    new Map<number, (element: HTMLElement | null) => void>(),
  );
  const setItemRef = useCallback((index: number) => {
    const cached = refCallbacks.current.get(index);
    if (cached !== undefined) return cached;
    const callback = (element: HTMLElement | null) => {
      elements.current[index] = element;
    };
    refCallbacks.current.set(index, callback);
    return callback;
  }, []);

  return {
    activeIndex: effectiveIndex,
    getTabIndex,
    setItemRef,
    focusNext,
    focusPrevious,
    focusFirst,
    focusLast,
    focusAt,
  };
}
