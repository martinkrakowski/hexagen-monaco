"use client";

import type { LLMEngineStatus } from "@hexagen/local-llm";
import { AlertTriangle } from "lucide-react";

interface UnavailableCardProps {
  status: Exclude<
    LLMEngineStatus,
    | "ready"
    | "downloading"
    | "loading_vram"
    | "error"
    | "opt_in"
    | "unavailable"
  >;
}

const MESSAGES: Record<
  UnavailableCardProps["status"],
  { title: string; body: string }
> = {
  no_webgpu: {
    title: "WebGPU Not Available",
    body: "Your browser or device doesn't support WebGPU. Local AI requires WebGPU to run models in the browser.",
  },
  unsupported_browser: {
    title: "Browser Not Supported",
    body: "Local AI requires a modern browser with WebGPU support. Please use Chrome 113+, Edge 113+, or Safari Technology Preview.",
  },
};

export function UnavailableCard({ status }: UnavailableCardProps) {
  const msg = MESSAGES[status];

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
      </div>
      <div className="text-center space-y-1">
        <h3 className="text-base font-semibold">{msg.title}</h3>
        <p className="text-sm text-muted-foreground max-w-[260px]">
          {msg.body}
        </p>
      </div>
    </div>
  );
}
