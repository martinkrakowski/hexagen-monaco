"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { wizardSteps } from "../../../features/project-wizard/config";

export default function WizardStepPage() {
  const params = useParams<{ step: string }>();
  const router = useRouter();
  const step = parseInt(params.step, 10);

  useEffect(() => {
    if (Number.isNaN(step) || step < 1 || step > wizardSteps.length) {
      router.replace("/wizard/1");
    }
  }, [step, router]);

  return null;
}
