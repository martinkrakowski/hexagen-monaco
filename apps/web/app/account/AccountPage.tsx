"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@hexagen/ui";

export function AccountPage() {
  const { data } = useSession();
  const login = data?.user?.login ?? data?.user?.name ?? "signed in";

  return (
    <div className="min-h-screen bg-background p-8">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <p className="text-sm text-foreground">Signed in as {login}.</p>
          <p className="text-sm text-muted-foreground">
            GitHub identity is publish-authorization only. Generation still uses
            the free-tier quota unless a repo-priced plan is active.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/billing">
              <Button variant="outline" size="sm">
                Billing
              </Button>
            </Link>
            <Link href="/projects">
              <Button variant="outline" size="sm">
                Projects
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void signOut({ callbackUrl: "/projects" })}
            >
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
