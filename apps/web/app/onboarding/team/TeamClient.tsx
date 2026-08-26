"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TeamStep } from "@/account-onboarding/components/TeamStep";
import { stepHref } from "@/account-onboarding/domain/onboarding-steps";
import { HttpOrgsAdapter } from "@/lib/adapters/http-orgs.adapter";

type TeamsGateway = Pick<HttpOrgsAdapter, "createTeam">;

interface TeamClientProps {
  readonly router?: {
    push: (url: string) => void;
    replace: (url: string) => void;
  };
  readonly gateway?: TeamsGateway;
}

export function TeamClient({
  router: injectedRouter,
  gateway = new HttpOrgsAdapter(),
}: TeamClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  // The created org id, carried by the org step via `?org=`. Without it a
  // team has nothing to belong to — send the user back to the workspace
  // choice (the NameStepClient unknown-path idiom).
  const orgId = searchParams.get("org");
  useEffect(() => {
    if (!orgId) router.replace(stepHref("workspace"));
  }, [orgId, router]);

  const goToInvites = useCallback(() => {
    if (!orgId) return;
    router.push(`${stepHref("invites")}?org=${encodeURIComponent(orgId)}`);
  }, [router, orgId]);

  const handleCreate = useCallback(
    async (name: string, slug: string) => {
      if (!orgId) return;
      setBusy(true);
      setValidationMessage(null);

      const created = await gateway.createTeam(orgId, { name, slug });
      if (created.success) {
        goToInvites();
        return; // keep busy while navigating away
      }

      setValidationMessage(
        created.error.kind === "conflict"
          ? "That team slug is taken in this organization — pick another."
          : created.error.message,
      );
      setBusy(false);
    },
    [gateway, orgId, goToInvites],
  );

  if (!orgId) return null;

  return (
    <TeamStep
      busy={busy}
      validationMessage={validationMessage}
      onCreate={(name, slug) => void handleCreate(name, slug)}
      onBack={() => router.push(stepHref("org"))}
      // TeamStep's Skip means "no first team" — continue to invites, it does
      // NOT complete onboarding (unlike the wizard-wide "Skip setup").
      onSkip={goToInvites}
    />
  );
}
