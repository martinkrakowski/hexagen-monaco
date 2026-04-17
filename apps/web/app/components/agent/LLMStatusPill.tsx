"use client";

import type { LLMEngineStatus } from "@hexagen/local-llm";
import { Cpu, AlertTriangle, Loader2 } from "lucide-react";

interface LLMStatusPillProps {
  status: LLMEngineStatus;
}

export function LLMStatusPill({ status }: LLMStatusPillProps) {
  if (status === "unavailable" || status === "opt_in") return null;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
      data-status={status}
    >
      {status === "downloading" || status === "loading_vram" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span className="text-primary">
            {status === "downloading" ? "Downloading" : "Loading"}
          </span>
        </>
      ) : status === "ready" ? (
        <>
          <Cpu className="h-3 w-3 text-green-500" />
          <span className="text-green-500">Local AI</span>
        </>
      ) : status === "error" ||
        status === "no_webgpu" ||
        status === "unsupported_browser" ? (
        <>
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <span className="text-amber-500">AI Unavailable</span>
        </>
      ) : null}
    </div>
  );
}
