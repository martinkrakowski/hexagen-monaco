"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DoneStep,
  type OnboardingSummary,
} from "@/account-onboarding/components/DoneStep";
import { HttpOrgsAdapter } from "@/lib/adapters/http-orgs.adapter";
import { fetchWithCsrf } from "@/lib/csrf-fetch";
import { completeOnboardingAndGo } from "../complete-onboarding";

type OrgsGateway = Pick<HttpOrgsAdapter, "listOrgs">;

// MODULE-LEVEL default, not a `= new HttpOrgsAdapter()` prop default: a
// per-render default would be a fresh object each render, and the summary
// effect below depends on `gateway` — setSummary would re-render, re-create
// the adapter, re-run the effect, and refetch forever (review flag on #667).
const defaultGateway: OrgsGateway = new HttpOrgsAdapter();

interface DoneClientProps {
  readonly router?: {
    push: (url: string) => void;
    replace: (url: string) => void;
  };
  readonly gateway?: OrgsGateway;
  readonly fetchImpl?: typeof fetch;
}

/** Best-effort roster counts; a failed listing degrades to zeros, not a wall. */
async function fetchRosterCounts(
  fetchImpl: typeof fetch,
  orgId: string,
): Promise<{ memberCount: number; pendingInviteCount: number }> {
  try {
    const response = await fetchImpl(
      `/api/orgs/${encodeURIComponent(orgId)}/members`,
    );
    if (!response.ok) return { memberCount: 0, pendingInviteCount: 0 };
    const body = (await response.json()) as {
      members?: unknown[];
      pendingInvites?: unknown[];
    };
    return {
      memberCount: Array.isArray(body.members) ? body.members.length : 0,
      pendingInviteCount: Array.isArray(body.pendingInvites)
        ? body.pendingInvites.length
        : 0,
    };
  } catch {
    return { memberCount: 0, pendingInviteCount: 0 };
  }
}

export function DoneClient({
  router: injectedRouter,
  gateway = defaultGateway,
  fetchImpl = fetchWithCsrf,
}: DoneClientProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<OnboardingSummary | undefined>();
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  const orgId = searchParams.get("org");

  // The summary is RE-DERIVED from the server, never trusted from wizard
  // state: `?org=` is only a pointer, and the org's name/slug and the roster
  // counts come fresh from GET /api/orgs + the members listing. A refresh of
  // this page therefore always shows what actually exists.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!orgId) {
        // Nothing was created in this run — personal workspace.
        if (!cancelled) setSummary({ org: null });
        return;
      }
      const mine = await gateway.listOrgs();
      if (cancelled) return;
      const org = mine.success
        ? mine.value.find((o) => o.id === orgId)
        : undefined;
      if (!org) {
        setValidationMessage(
          "Couldn't load your organization summary — it's still there, and your workspace has the details.",
        );
        return;
      }
      const counts = await fetchRosterCounts(fetchImpl, orgId);
      if (cancelled) return;
      setSummary({ org: { name: org.name, slug: org.slug, ...counts } });
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, gateway, fetchImpl]);

  const handleGo = useCallback(() => {
    setBusy(true);
    // Tenant preselection of the new org is wired in a later packet.
    void completeOnboardingAndGo(router);
  }, [router]);

  return (
    <DoneStep
      summary={summary}
      busy={busy}
      validationMessage={validationMessage}
      onGoToWorkspace={handleGo}
    />
  );
}
