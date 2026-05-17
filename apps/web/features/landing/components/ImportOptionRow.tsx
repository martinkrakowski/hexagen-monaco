"use client";

import {
  FileCode,
  Braces,
  GitBranch,
  Github,
  ChevronRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ImportSubOption } from "@/landing/domain/creation-path";

const iconMap = {
  // FileText icon unavailable in lucide-react; FileCode used as visual substitute
  FileText: FileCode,
  FileCode,
  Braces,
  GitBranch,
  Github,
} as const;

interface ImportOptionRowProps {
  readonly option: ImportSubOption;
  readonly router?: { push: (url: string) => void };
}

export function ImportOptionRow({
  option,
  router: injectedRouter,
}: ImportOptionRowProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const IconComponent =
    iconMap[option.iconName as keyof typeof iconMap] ?? FileCode;

  if (option.status !== "available") {
    return (
      <div
        role="presentation"
        className="w-full flex items-start gap-4 p-4 rounded-lg border border-border bg-card opacity-50 cursor-not-allowed"
      >
        <div className="w-10 h-10 rounded-md flex items-center justify-center bg-info/10 shrink-0 mt-0.5">
          <IconComponent className="h-5 w-5 text-info" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm">
            {option.label}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
            {option.description}
          </p>
        </div>
        <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
          Coming soon
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => router.push(option.href)}
      className={cn(
        "group w-full flex items-start gap-4 p-4 rounded-lg border border-border",
        "bg-card text-left transition-all",
        "hover:border-info/40 hover:bg-accent/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.98]",
      )}
    >
      <div className="w-10 h-10 rounded-md flex items-center justify-center bg-info/10 group-hover:bg-info/20 shrink-0 mt-0.5">
        <IconComponent className="h-5 w-5 text-info" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground text-sm">{option.label}</p>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          {option.description}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
