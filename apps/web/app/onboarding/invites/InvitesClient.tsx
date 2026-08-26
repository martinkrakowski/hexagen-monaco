"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InvitesStep } from "@/account-onboarding/components/InvitesStep";
import { stepHref } from "@/account-onboarding/domain/onboarding-steps";
import {
  HttpOrgsAdapter,
  type OrgInviteReceipt,
} from "@/lib/adapters/http-orgs.adapter";
import { completeOnboardingAndGo } from "../complete-onboarding";

type InvitesGateway = Pick<HttpOrgsAdapter, "inviteMember">;

// Module-level default (see DoneClient): a per-render `new HttpOrgsAdapter()`
// prop default is a fresh identity every render.
const defaultGateway: InvitesGateway = new HttpOrgsAdapter();

interface InvitesClientProps {
  readonly router?: {
    push: (url: string) => void;
    replace: (url: string) => void;
  };
  readonly gateway?: InvitesGateway;
}

export function InvitesClient({
  router: injectedRouter,
  gateway = defaultGateway,
}: InvitesClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  // 202 receipts in invite order. The list holds what the SERVER answered,
  // never a locally-fabricated entry — the expiry shown comes from the
  // receipt.
  const [invites, setInvites] = useState<readonly OrgInviteReceipt[]>([]);

  const orgId = searchParams.get("org");
  useEffect(() => {
    if (!orgId) router.replace(stepHref("workspace"));
  }, [orgId, router]);

  const handleInvite = useCallback(
    async (githubLogin: string, role: "owner" | "member") => {
      if (!orgId) return;
      setBusy(true);
      setValidationMessage(null);

      const invited = await gateway.inviteMember(orgId, { githubLogin, role });
      if (invited.success) {
        setInvites((current) => [...current, invited.value]);
      } else {
        setValidationMessage(invited.error.message);
      }
      setBusy(false);
    },
    [gateway, orgId],
  );

  const handleSkip = useCallback(() => {
    setBusy(true);
    void completeOnboardingAndGo(router);
  }, [router]);

  if (!orgId) return null;

  return (
    <InvitesStep
      busy={busy}
      validationMessage={validationMessage}
      invites={invites}
      onInvite={(githubLogin, role) => void handleInvite(githubLogin, role)}
      onBack={() =>
        router.push(`${stepHref("team")}?org=${encodeURIComponent(orgId)}`)
      }
      onContinue={() =>
        router.push(`${stepHref("done")}?org=${encodeURIComponent(orgId)}`)
      }
      onSkip={handleSkip}
    />
  );
}
