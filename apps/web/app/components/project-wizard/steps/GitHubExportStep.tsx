"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { signIn, signOut, useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

interface GitHubExportStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  currentStep: number;
  totalSteps: number;
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
    return isAuthenticated && repoName.trim().length > 0;
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
    if (!isAuthenticated) {
      setUiError("Sign in with GitHub before continuing.");
      return;
    }

    if (!repoName.trim()) {
      setUiError("Repository name is required.");
      return;
    }

    if (session?.user?.name) {
      setValue("gitHubExport.owner", session.user.name, { shouldDirty: true });
    }

    setUiError(null);
    onNext();
  };

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <Card className="w-full border border-border">
          <CardHeader>
            <CardTitle className="text-lg font-medium">
              GitHub Export Configuration
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="border border-border rounded-lg p-4 bg-muted/40">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">GitHub Connection</p>
                  <p className="text-xs text-muted-foreground">
                    {isAuthenticated
                      ? `Connected as ${session?.user?.name ?? "GitHub user"}`
                      : "Connect your GitHub account to enable repository export."}
                  </p>
                </div>

                {isAuthenticated ? (
                  <PrimaryButton
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={authPending}
                    onClick={handleSignOut}
                  >
                    {authPending ? "Signing out..." : "Sign Out"}
                  </PrimaryButton>
                ) : (
                  <PrimaryButton
                    type="button"
                    size="sm"
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

      <footer className="flex-shrink-0 bg-background border-t border-border p-4 flex justify-between items-center z-10">
        <PrimaryButton type="button" variant="outline" onClick={onBack}>
          Back
        </PrimaryButton>

        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </span>
          <PrimaryButton
            type="button"
            onClick={handleContinue}
            disabled={!canProceed || !isFormValid}
          >
            Continue
          </PrimaryButton>
        </div>
      </footer>
    </div>
  );
};
