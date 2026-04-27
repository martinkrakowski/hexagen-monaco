"use client";

import { Loader2 } from "lucide-react";
import type { Patch } from "@hexagen/reconciliation-engine";
import { PatchReviewPanel } from "../../governance-assistant/architecture-modification/PatchReviewPanel";
import { StepHeader } from "../steps/StepHeader";
import { WizardFooter } from "../WizardFooter";

interface ReviewStepProps {
  transactionId: string;
  patches: Patch[];
  onAccept: () => void;
  onReject: () => void;
  onBack: () => void;
  isAccepting?: boolean;
  isRejecting?: boolean;
}

export function ReviewStep({
  transactionId,
  patches,
  onAccept,
  onReject,
  onBack,
  isAccepting = false,
  isRejecting = false,
}: ReviewStepProps) {
  const isLoading = isAccepting || isRejecting;

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={6}
        totalSteps={6}
        title="Review Architecture Changes"
        description="Review the proposed changes before applying them to your project."
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-4 mb-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
            <span className="text-sm text-muted-foreground">
              {isAccepting ? "Accepting changes..." : "Rejecting changes..."}
            </span>
          </div>
        )}
        <PatchReviewPanel
          patches={patches}
          onAcceptAll={onAccept}
          onRejectAll={onReject}
        />
      </div>

      <WizardFooter
        onBack={onBack}
        canProceed={!isLoading}
        showNext={false}
      />
    </div>
  );
}