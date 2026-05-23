"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Checkbox,
} from "@hexagen/ui";
import { X } from "lucide-react";
import { usePreferredLLM } from "./store/usePreferredLLM";
import { useLocalLLM } from "@/llm-driver/useLocalLlm";

interface FreeTierModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FreeTierModelModal({
  open,
  onOpenChange,
}: FreeTierModelModalProps) {
  const [preferWebLLM, setPreferWebLLM] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { preferredLocalModel, clearPreferredLocalModel } = usePreferredLLM();
  const llmContext = useLocalLLM();
  const webLLMReady = llmContext.loadedModel !== null;

  useEffect(() => {
    if (open && preferredLocalModel) {
      setPreferWebLLM(true);
    } else if (open) {
      setPreferWebLLM(false);
    }
  }, [open, preferredLocalModel]);

  const handlePreferWebLLM = async () => {
    if (preferredLocalModel) {
      if (llmContext.switchModel && webLLMReady) {
        await llmContext.switchModel(preferredLocalModel);
      }
      onOpenChange(false);
    } else {
      const returnUrl = pathname;
      router.push(
        `/projects/new/ai/models?returnUrl=${encodeURIComponent(returnUrl)}`,
      );
      onOpenChange(false);
    }
  };

  const handleSwitchToFreeTier = () => {
    clearPreferredLocalModel();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)}>
      {open && (
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Free Tier Model</DialogTitle>
              <button
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted p-1"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <DialogDescription>
              Model performance and limitations
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                Rate Limit: 40 Tokens Per Second
              </h3>
              <p className="text-sm text-muted-foreground">
                This free tier model is rate-limited to 40 tokens per second.
                Generation may take significantly longer compared to other LLM
                providers.
              </p>
            </div>

            <div className="bg-card border border-border rounded-lg p-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold">⏱ Expected Duration:</span> For
                typical projects, manifest generation may take 5–10 minutes
                depending on project complexity.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-3">
                Faster Alternatives
              </h3>

              <div className="space-y-3">
                <div className="border border-border rounded-lg p-3 hover:bg-card/50 transition-colors">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={preferWebLLM}
                      onCheckedChange={setPreferWebLLM}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">
                        Use WebLLM (Local)
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Runs entirely in your browser with no network latency.
                        Fastest option for small-to-medium projects.
                        {preferredLocalModel
                          ? webLLMReady
                            ? " Ready to use now."
                            : " Model selected, ready to activate."
                          : webLLMReady
                            ? " Ready to use now."
                            : " Select and download a model first."}
                      </p>
                    </div>
                  </label>
                </div>

                <div className="border border-border rounded-lg p-3">
                  <p className="font-medium text-foreground mb-1">
                    Bring Your Own Keys (BYOK)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Use your own OpenAI, Anthropic, or other high-tier API keys
                    for faster processing.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground pt-2 border-t border-border">
              To switch models, update your LLM configuration in Settings and
              restart the application.
            </div>
          </div>
          <DialogFooter>
            {preferWebLLM ? (
              <Button onClick={handlePreferWebLLM} className="mr-auto">
                {preferredLocalModel && webLLMReady
                  ? "Switch to WebLLM"
                  : preferredLocalModel
                    ? "Activate WebLLM Model"
                    : "Select WebLLM Model"}
              </Button>
            ) : preferredLocalModel ? (
              <Button onClick={handleSwitchToFreeTier} className="mr-auto">
                Switch to Free Tier Model
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
