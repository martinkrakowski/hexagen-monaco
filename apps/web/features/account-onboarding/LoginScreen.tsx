"use client";

import { Button } from "@hexagen/ui";
import { ProjectsShell } from "@/ProjectsShell";

interface LoginScreenProps {
  readonly onSignIn: () => void;
  readonly busy?: boolean;
}

/**
 * App sign-in, framed as such (D-U2/D-U3): an account is what holds projects,
 * organizations and teams — and since the 2026-08-25 owner decision, every
 * plan INCLUDING the free tier requires one. This copy must not drift back
 * into the old "OAuth authorizes publish" framing; publishing is mentioned
 * only to explain why the identity provider is GitHub.
 */
export function LoginScreen({ onSignIn, busy = false }: LoginScreenProps) {
  return (
    <ProjectsShell title="Sign in">
      <div className="h-full overflow-y-auto dot-grid bg-ambient">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-xl mx-auto px-4 sm:px-6 w-full">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-balance">
                Sign in to Hexagen-Monaco
              </h2>
              <p className="text-sm text-muted-foreground">
                Your projects, organizations, and teams live in your account.
                Every plan — including the free tier — requires one.
              </p>
              <p className="text-sm text-muted-foreground">
                Sign-in uses your GitHub identity. Publishing generated projects
                to GitHub uses the same authorization later.
              </p>
              <Button className="w-full" disabled={busy} onClick={onSignIn}>
                Continue with GitHub
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ProjectsShell>
  );
}
