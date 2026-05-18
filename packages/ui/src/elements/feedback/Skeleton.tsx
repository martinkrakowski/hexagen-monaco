import React from "react";

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({
  className = "h-8 w-full rounded-md bg-gray-200 animate-pulse",
}: SkeletonProps) {
  return <div className={className} aria-hidden="true" role="presentation" />;
}
