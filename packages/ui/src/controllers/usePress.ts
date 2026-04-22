import type { PointerEvent, MouseEvent } from "react";

export interface UsePressOptions {
  onPress?: (e: { type: "press"; target: EventTarget }) => void;
  onPressStart?: (e: { type: "pressstart"; target: EventTarget }) => void;
  onPressEnd?: (e: { type: "pressend"; target: EventTarget }) => void;
  onPressUp?: (e: { type: "pressup"; target: EventTarget }) => void;
  isDisabled?: boolean;
}

export interface UsePressReturn {
  pressProps: Record<string, unknown>;
}

export function usePress(options: UsePressOptions): UsePressReturn {
  const handlePressStart = (e: PointerEvent) => {
    if (options.isDisabled) return;
    options.onPressStart?.({ type: "pressstart", target: e.currentTarget });
  };

  const handlePressEnd = (e: PointerEvent) => {
    if (options.isDisabled) return;
    options.onPressEnd?.({ type: "pressend", target: e.currentTarget });
  };

  const handleClick = (e: MouseEvent) => {
    if (options.isDisabled) return;
    options.onPress?.({ type: "press", target: e.currentTarget });
  };

  const pressProps: Record<string, unknown> = {
    onPointerDown: handlePressStart,
    onPointerUp: handlePressEnd,
    onClick: handleClick,
    "aria-disabled": options.isDisabled,
    role: "button",
  };

  return { pressProps };
}
