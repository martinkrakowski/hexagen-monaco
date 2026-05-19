"use client";

import { useRouter } from "next/navigation";
import type { ManifestImportSubOption } from "../domain/creation-path";

interface ImportOptionRowProps {
  option: ManifestImportSubOption;
}

export default function ImportOptionRow({ option }: ImportOptionRowProps) {
  const router = useRouter();

  if (option.status === "coming-soon") {
    return (
      <div
        role="presentation"
        className="w-full flex items-start gap-4 p-4 rounded-lg border border-border bg-card text-left opacity-50 cursor-not-allowed select-none"
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-info/10 text-info group-hover:bg-info/20">
          {/* Icon would go here - use dynamic icon rendering based on option.iconName */}
          <span className="text-lg">{option.iconName?.charAt(0) || "?"}</span>
        </div>
        <div className="flex-1">
          <p className="font-semibold text-foreground text-sm">
            {option.label}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
            {option.description}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            {option.detail}
          </p>
        </div>
        <div className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
          Coming soon
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => router.push(option.href)}
      className="w-full flex items-start gap-4 p-4 rounded-lg border border-border bg-card text-left transition-all group hover:border-info/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-info/10 text-info group-hover:bg-info/20">
        <span className="text-lg">{option.iconName?.charAt(0) || "?"}</span>
      </div>
      <div className="flex-1">
        <p className="font-semibold text-foreground text-sm">{option.label}</p>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          {option.description}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">{option.detail}</p>
      </div>
      <div className="shrink-0 text-muted-foreground group-hover:translate-x-0.5 transition-transform">
        →
      </div>
    </button>
  );
}
