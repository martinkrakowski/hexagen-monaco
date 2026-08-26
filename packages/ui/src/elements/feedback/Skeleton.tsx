import React from "react";
import type { NoSemanticState } from "../../types/forbidden-brand.js";

export type SkeletonProps = NoSemanticState<{
  className?: string;
}>;

export function Skeleton({
  className = "h-8 w-full rounded-md bg-muted animate-pulse",
}: SkeletonProps) {
  return <div className={className} aria-hidden="true" role="presentation" />;
}
