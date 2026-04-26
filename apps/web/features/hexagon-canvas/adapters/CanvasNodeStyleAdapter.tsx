/**
 * Canvas Node Style Adapter
 *
 * DESIGN.md §4 Exception: React Flow Integration
 *
 * This component is a limited exception to the "no inline styles" rule.
 * React Flow requires dynamic positioning via inline styles because:
 * - Node positions are calculated at runtime
 * - CSS classes cannot express arbitrary x/y coordinates
 * - We cannot use CSS-in-JS solutions due to build constraints
 *
 * All styling in this component converts to CSS variables when possible.
 * This adapter is the ONLY place inline styles are permitted for positioning.
 *
 * Usage:
 * ```tsx
 * <CanvasNodeStyleAdapter width={180} height={180} x={x} y={y}>
 *   <div className="bg-card rounded-lg p-4">Content</div>
 * </CanvasNodeStyleAdapter>
 * ```
 */

import React from "react";

export interface CanvasNodeStyleProps {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  opacity?: number;
  children: React.ReactNode;
  className?: string;
}

export function CanvasNodeStyleAdapter({
  width,
  height,
  x,
  y,
  opacity,
  children,
  className,
}: CanvasNodeStyleProps) {
  const style: React.CSSProperties = {
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : undefined,
    transform:
      x !== undefined && y !== undefined
        ? `translate(${x}px, ${y}px)`
        : undefined,
    opacity: opacity !== undefined ? opacity : undefined,
  };

  return (
    <div style={style} className={className}>
      {children}
    </div>
  );
}
