"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { signIn, signOut, useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface GitHubExportStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  currentStep: number;
  totalSteps: number;
  title?: string;
  description?: string;
}

type WizardFormValues = {
  gitHubExport?: {
    repoName?: string;
    isPrivate?: boolean;
    owner?: string;
  };
};

export const GitHubExportStep = ({
  onNext,
  onBack,
  canProceed,
  currentStep,
  totalSteps,
  title,
  description,
}: GitHubExportStepProps) => {
  const { getValues, setValue } = useFormContext<WizardFormValues>();
  const { data: session, status } = useSession();

  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);

  useEffect(() => {
    const values = getValues("gitHubExport");
    setRepoName(values?.repoName ?? "");
    setIsPrivate(Boolean(values?.isPrivate));
  }, [getValues]);

  const isAuthenticated = status === "authenticated";

  const isFormValid = useMemo(() => {
    // GitHub export is optional - can proceed without authentication
    // If not authenticated, skip the GitHub export step (generate locally only)
    return !isAuthenticated || repoName.trim().length > 0;
  }, [isAuthenticated, repoName]);

  const persistRepoName = (value: string) => {
    setRepoName(value);
    setValue("gitHubExport.repoName", value, { shouldDirty: true });
    setUiError(null);
  };

  const persistVisibility = (value: boolean) => {
    setIsPrivate(value);
    setValue("gitHubExport.isPrivate", value, { shouldDirty: true });
  };

  const handleSignIn = async () => {
    setAuthPending(true);
    setUiError(null);
    try {
      await signIn("github");
    } finally {
      setAuthPending(false);
    }
  };

  const handleSignOut = async () => {
    setAuthPending(true);
    setUiError(null);
    try {
      await signOut({ callbackUrl: "/" });
    } finally {
      setAuthPending(false);
    }
  };

  const handleContinue = () => {
    // GitHub export is optional - allow continuing without authentication
    if (!isAuthenticated) {
      // User not authenticated - will generate locally only, skip GitHub export
      setValue("gitHubExport", undefined, { shouldDirty: true });
      onNext();
      return;
    }

    if (!repoName.trim()) {
      setUiError("Repository name is required.");
      return;
    }

    // Prefer login (GitHub username) over name (display name) — the GitHub
    // API requires username for repository ownership, not the display name.
    const ownerLogin = session?.user?.login;
    if (ownerLogin) {
      setValue("gitHubExport.owner", ownerLogin, { shouldDirty: true });
    }

    setUiError(null);
    onNext();
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "GitHub Export"}
        description={description || "Configure GitHub export."}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-6">
        <Card className="w-full border border-border">
          <CardHeader>
            <CardTitle className="text-lg font-medium">
              GitHub Export Configuration
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="border border-border rounded-lg p-2 bg-muted/40">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">GitHub Connection</p>
                  <p className="text-xs text-muted-foreground">
                    {isAuthenticated
                      ? `Connected as ${session?.user?.name ?? "GitHub user"}`
                      : "Connect your GitHub account to enable repository export."}
                  </p>
                </div>

                {isAuthenticated ? (
                  <div className="flex justify-end">
                    <PrimaryButton
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={authPending}
                      onClick={handleSignOut}
                    >
                      {authPending ? "Signing out..." : "Sign Out"}
                    </PrimaryButton>
                  </div>
                ) : (
                  <PrimaryButton
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={authPending}
                    onClick={handleSignIn}
                  >
                    {authPending ? "Signing in..." : "Sign In with GitHub"}
                  </PrimaryButton>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="github-repo-name" className="text-sm font-medium">
                Repository Name
              </label>
              <Input
                id="github-repo-name"
                value={repoName}
                onChange={(e) => persistRepoName(e.target.value)}
                placeholder="my-hexagen-project"
              />
              <p className="text-xs text-muted-foreground">
                The repository will be created in your authenticated account.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="github-private"
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => persistVisibility(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <label htmlFor="github-private" className="text-sm font-medium">
                Private repository
              </label>
            </div>

            {uiError ? (
              <p className="text-xs text-destructive">{uiError}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <WizardFooter
        onBack={onBack}
        onNext={handleContinue}
        canProceed={canProceed && isFormValid}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
};
