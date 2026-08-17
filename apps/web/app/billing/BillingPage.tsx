"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@hexagen/ui";
import type { Entitlement, PlanDefinition } from "../../lib/platform";

interface EntitlementResponse {
  entitlement: Entitlement;
  plan: PlanDefinition;
  usesFreeQuota: boolean;
}

export function BillingPage() {
  const [payload, setPayload] = useState<EntitlementResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/billing/entitlement")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed");
        return (await response.json()) as EntitlementResponse;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-8">
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Plans are priced per repository, not per seat. Without an active
            subscription this deployment stays on the existing free quota.
          </p>
          {payload ? (
            <div className="text-sm text-foreground space-y-1">
              <p>Plan: {payload.plan.plan}</p>
              <p>Repo limit: {payload.plan.repoLimit}</p>
              <p>
                Metering:{" "}
                {payload.usesFreeQuota
                  ? "free-tier daily quota"
                  : "repo-priced entitlement"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading plan…</p>
          )}
          <Link href="/account">
            <Button variant="outline" size="sm">
              Back to account
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
