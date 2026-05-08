"use client";

interface ProjectRowSkeletonProps {
  rows?: number;
}

export function ProjectRowSkeleton({ rows = 3 }: ProjectRowSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-border"
        >
          <div className="w-5 h-5 rounded bg-muted overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-card to-transparent animate-shimmer" />
          </div>
          <div className="flex-1 h-4 rounded bg-muted overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-card to-transparent animate-shimmer" />
          </div>
          <div className="w-32 h-4 rounded bg-muted overflow-hidden relative hidden md:block">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-card to-transparent animate-shimmer" />
          </div>
          <div className="w-32 h-4 rounded bg-muted overflow-hidden relative hidden lg:block">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-card to-transparent animate-shimmer" />
          </div>
          <div className="w-20" />
        </div>
      ))}
    </>
  );
}
