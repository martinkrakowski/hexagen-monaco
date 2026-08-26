# ADR-0070: Account required for every plan — deny-by-default auth gate

## Status

Accepted (owner decision, 2026-08-25)

## Context

Since launch the free tier was anonymous by design: `/projects` and the
generate APIs were deliberately unauthenticated (quota-D2), metered per
browser via the `hxg_sid` cookie, with a silent IndexedDB fallback for
persistence (H1.7). Three artifacts defended that policy: the
`middleware.test.ts` guardrail asserting the open paths, the quota-D2 note in
`lib/platform/require-owner.ts`, and ADR-0063's freeze of the eight metering
files.

With accounts, organizations, teams, and project sharing shipped (#650–#659),
the owner decided on 2026-08-25: **"All plans including the free tier should
require a signup/account."**

## Decision

1. **Deny-by-default middleware gate.** Every page and API requires a session
   JWT, with an exact allowlist: `/login` (the gate's redirect
   target), `/auth` (legacy sign-in redirect — a published contract),
   `/api/auth` (NextAuth's own surface, which must be reachable to create a
   session; also the deploy healthcheck target), and `/api/csrf` (token
   issuance). Pages redirect 307 to the login screen with the full deep link
   as `callbackUrl`; APIs answer 401 with the exact body
   `requirePersistenceOwner` uses (`"Sign in required"` — the client's
   `isUnauthenticatedPersistenceError` string-matches it).

2. **ADR-0063 stays intact by construction.** The frozen metering files are
   gated in FRONT by middleware and are not edited. Quota logic is unchanged;
   it now always runs behind authentication. Re-keying quota from the
   `hxg_sid` cookie to user ids is a separate, open owner decision (it changes
   limit semantics from per-browser to per-account).

3. **The free tier survives as an entitlement.** What ends is anonymity, not
   the tier: a signed-in account without a paid plan is on the free tier.

4. **The old guardrail test is rewritten, not deleted.** `middleware.test.ts`
   now pins the new policy (deny-by-default, exact allowlist, denial-body
   coupling) with the reversal dated in its header comment — the same
   drift-protection duty, opposite polarity.

## Consequences

- Quota-D2's browser half and H1.7's anonymous half are superseded. The
  IndexedDB adapter remains as the offline/personal-tenant cache for
  signed-in users; the first signed-in load performs the one-time IDB→server
  lift for pre-gate anonymous work.
- The acquisition funnel changes: `/` (a browser-cached 308 to
  `/projects/new`) now lands unauthenticated visitors on the login screen.
  Accepted knowingly.
- The `hxg_sid` anonymous-session cookie continues to exist and meter
  free-tier usage for signed-in users until the re-keying decision lands.
- Plan: `docs/planning/2026-08-25-login-onboarding-ui-plan.md` (D-U1, P-U3).
