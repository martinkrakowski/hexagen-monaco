"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrgStep } from "@/account-onboarding/components/OrgStep";
import { stepHref } from "@/account-onboarding/domain/onboarding-steps";
import { HttpOrgsAdapter } from "@/lib/adapters/http-orgs.adapter";
import { completeOnboardingAndGo } from "../complete-onboarding";

type OrgsGateway = Pick<HttpOrgsAdapter, "createOrg" | "listOrgs">;

interface OrgClientProps {
  readonly router?: {
    push: (url: string) => void;
    replace: (url: string) => void;
  };
  readonly gateway?: OrgsGateway;
}

export function OrgClient({
  router: injectedRouter,
  gateway = new HttpOrgsAdapter(),
}: OrgClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  const carriedOrgId = searchParams.get("org");

  const goToTeam = useCallback(
    (orgId: string) => {
      router.push(`${stepHref("team")}?org=${encodeURIComponent(orgId)}`);
    },
    [router],
  );

  const handleCreate = useCallback(
    async (name: string, slug: string) => {
      setBusy(true);
      setValidationMessage(null);

      const created = await gateway.createOrg({ name, slug });
      if (created.success) {
        goToTeam(created.value.id);
        return; // keep busy while navigating away
      }

      if (created.error.kind === "conflict") {
        // Replay safety: a refresh (or Back) re-submitting the same form must
        // not double-create — the server's UNIQUE slug index already
        // guarantees it can't, so this branch is UX, not integrity. If this
        // page already carries the created org (`?org=`), or the caller
        // already OWNS an org with this exact slug, the 409 means "you
        // already did this" — continue forward instead of erroring.
        if (carriedOrgId) {
          goToTeam(carriedOrgId);
          return;
        }
        const mine = await gateway.listOrgs();
        const existing = mine.success
          ? mine.value.find((o) => o.slug === slug && o.role === "owner")
          : undefined;
        if (existing) {
          goToTeam(existing.id);
          return;
        }
        setValidationMessage("That slug is taken — pick another.");
        setBusy(false);
        return;
      }

      setValidationMessage(created.error.message);
      setBusy(false);
    },
    [gateway, carriedOrgId, goToTeam],
  );

  const handleSkip = useCallback(() => {
    setBusy(true);
    void completeOnboardingAndGo(router);
  }, [router]);

  return (
    <OrgStep
      busy={busy}
      validationMessage={validationMessage}
      onCreate={(name, slug) => void handleCreate(name, slug)}
      onBack={() => router.push(stepHref("workspace"))}
      onSkip={handleSkip}
    />
  );
}
