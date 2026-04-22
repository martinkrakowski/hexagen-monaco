"use client";

import type { ReactNode } from "react";

interface SummarySectionProps {
  title: string;
  children: ReactNode;
}

/**
 * Shared wrapper for the review-summary cards. Five summary sections
 * (governance, contexts, mappings, template, export) all share the
 * same bordered-card-with-title markup — extracted here to keep the
 * visual language consistent and the per-section files focused on
 * their unique content.
 */
export function SummarySection({ title, children }: SummarySectionProps) {
  return (
    <div className="border border-border rounded-lg p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
