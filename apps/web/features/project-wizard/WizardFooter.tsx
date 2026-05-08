"use client";

import Link from "next/link";

interface WizardFooterProps {
  onBack?: () => void;
  onNext?: () => void;
  onGenerate?: () => void;
  canProceed?: boolean;
  isGenerating?: boolean;
  currentStep?: number;
  totalSteps?: number;
  showBack?: boolean;
  showNext?: boolean;
  nextLabel?: string;
}

export function WizardFooter({
  onBack,
  onNext,
  onGenerate,
  canProceed = true,
  isGenerating = false,
  currentStep,
  totalSteps,
  showBack = true,
  showNext = true,
  nextLabel = "Next",
}: WizardFooterProps) {
  return (
    <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center">
      {showBack && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input"
        >
          Back
        </button>
      )}
      {!showBack && (
        <Link
          href="/projects"
          className="px-6 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted rounded-md transition-colors border border-input"
        >
          Previous Projects
        </Link>
      )}
      <div className="flex items-center gap-4">
        {currentStep !== undefined && totalSteps !== undefined && (
          <span className="text-xs text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </span>
        )}
        {showNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed || isGenerating}
            className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? "Generating..." : nextLabel}
          </button>
        )}
        {!showNext && onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canProceed || isGenerating}
            className="px-8 py-2.5 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? "Generating..." : "Generate Project"}
          </button>
        )}
      </div>
    </footer>
  );
}
