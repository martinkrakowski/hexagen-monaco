"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";

import { wizardSteps } from "../../project-wizard/config";

export function useStepNavigation(currentStepIndex: number) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const goNext = useCallback(() => {
    const nextStep = Math.min(currentStepIndex + 1, wizardSteps.length - 1);
    router.push(`/wizard/${nextStep + 1}?${searchParams.toString()}`);
  }, [router, searchParams, currentStepIndex]);

  const goBack = useCallback(() => {
    const prevStep = Math.max(currentStepIndex - 1, 0);
    router.push(`/wizard/${prevStep + 1}?${searchParams.toString()}`);
  }, [router, searchParams, currentStepIndex]);

  const goToStep = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, wizardSteps.length - 1));
      router.push(`/wizard/${clamped + 1}?${searchParams.toString()}`);
    },
    [router, searchParams],
  );

  return { goNext, goBack, goToStep } as const;
}
