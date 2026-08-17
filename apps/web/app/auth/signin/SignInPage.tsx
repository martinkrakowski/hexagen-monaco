"use client";

import { signIn } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@hexagen/ui";

interface SignInPageProps {
  callbackUrl?: string;
}

export function SignInPage({ callbackUrl = "/projects" }: SignInPageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            Sign in
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            GitHub OAuth authorizes publish to your repositories. It does not
            unlock unlimited generation — that stays on the free-tier quota
            until a repo-priced plan is active.
          </p>
          <Button
            className="w-full"
            onClick={() => void signIn("github", { callbackUrl })}
          >
            Continue with GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
