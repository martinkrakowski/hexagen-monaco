# Login screen and onboarding wizard — UI integration plan

**Date:** 2026-08-25
**Predecessors:** `2026-08-23-accounts-orgs-teams-sharing-plan.md` (the backend this UI consumes — P-A1..P-A6 all landed), `2026-08-20-hosting-migration-plan.md` (H1 tenancy)
**Baseline:** `main` @ `4df0160b` — the full accounts arc (#650–#659) is merged: orgs, teams, membership+invites, shares, `requireTenant`, D-H7 CSRF, `POST /api/orgs`, tenant-scoped project creation. Zero open PRs; main CI green.
**Ask:** a login screen and an onboarding wizard, both inside the `/new` application shell; routes and non-login/onboarding buttons disabled when unauthenticated; reuse `packages/ui`; the UI calls the new org/team/user backend for data and setup.

---

## 0. The one product conflict, stated first

**"Disable routes and buttons when unauthenticated" reverses a recorded product decision.** The anonymous free tier is deliberate and defended in three places:

- `middleware.test.ts:6-14` asserts `/projects` and the generate APIs are **not** auth-protected — a guardrail test written to stop exactly this broadening.
- `lib/platform/require-owner.ts` records "Generate routes stay ungated (quota-D2)".
- Hosting plan H1.7: "Anonymous users keep the silent-IDB fallback — the free tier keeps working offline."

**RESOLVED 2026-08-25 (owner decision):** "All plans including the free tier should require a signup/account." The reversal is total and intentional: the anonymous free tier ends. Quota-D2 and H1.7's anonymous halves are superseded; the guardrail tests are rewritten to assert the new policy (not deleted), each carrying a dated comment naming this decision. The free TIER survives — it is now the default entitlement of a signed-in account rather than of an anonymous cookie.

**ADR-0063 stays intact by construction:** the eight frozen metering files are not edited. The auth gate lands in `middleware.ts` (JWT presence over all pages and APIs, minus an explicit allowlist), in front of the frozen routes rather than inside them. Quota logic is unchanged — it simply now always runs behind authentication. Re-keying quota from the `hxg_sid` cookie to user ids is deliberately out of scope (§5): signed-in users still carry the cookie, so metering continues to function; unifying the keys is a follow-up owner decision because it changes limits semantics (per-browser → per-account).

## 1. Verified ground truth

Three exploration reports were taken against a stale checkout (pre-#650). Corrected, post-merge reality:

| Claim from exploration                                          | Post-merge reality                                                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireTenant` doesn't exist                                   | Exists: `lib/platform/require-owner.ts` — `requireTenant(request, ownerId)` → 401/403/`{tenantId, userId, access}`; `resolveProjectAccess` beside it     |
| `persistGithubLogin` / invite redemption absent                 | In the jwt callback (`app/lib/auth.ts`): captures `profile.login` → `users.github_login`, then redeems pending org invites — membership lands at sign-in |
| `middleware.ts` is only the `/account`,`/billing` auth redirect | Now also the D-H7 CSRF double-submit gate over `/api` mutating methods carrying a session cookie (`hexagen-csrf` cookie + `x-hexagen-csrf` header)       |
| `csrf-fetch.ts` / `/api/csrf` absent                            | Merged; `HttpSavedProjectsAdapter` defaults its fetcher to `fetchWithCsrf`; `postJson` in `app/lib/fetch-json.ts` is CSRF-correct                        |
| org/team routes unmerged                                        | All merged; surface inventoried below                                                                                                                    |

**Backend surface the UI consumes** (all on main):

| Route                                                                         | Methods                             | Notes for the UI                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/orgs`                                                                   | GET, POST                           | GET = caller's orgs with role (`OrgMembershipSummary`, one JOIN — built for the switcher). POST = create; 201, or 409 `duplicate` from the unique index. Slug `/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/` |
| `/api/orgs/[orgId]`                                                           | DELETE                              | 409 `org_owns_projects` with count while projects exist                                                                                                                                             |
| `/api/orgs/[orgId]/members`                                                   | POST                                | **Always 202 + invite**, even for existing users (stale-handle defense + anti-enumeration). Never render "added" — render "invited; joins at next sign-in"                                          |
| `/api/orgs/[orgId]/members/[userId]`                                          | PATCH, DELETE                       | Role change by immutable userId (owner-only, last-owner 409); removal incl. self (leave-org)                                                                                                        |
| `/api/orgs/[orgId]/teams`, `.../teams/[teamId]`, `.../teams/[teamId]/members` | GET/POST, DELETE, POST/DELETE       | Team slug 409 typed; team members must be org members                                                                                                                                               |
| `/api/projects/shared`                                                        | GET                                 | Shared-with-me, collapsed to strongest grant                                                                                                                                                        |
| `/api/tenants/[ownerId]/projects` (+`[projectId]`, `shares/*`)                | POST / GET/PUT/DELETE / POST/DELETE | Tenant-scoped CRUD + share management; `If-Match: rev:<n>`                                                                                                                                          |
| `/api/account/export`                                                         | GET                                 | Personal-tenant bundle                                                                                                                                                                              |
| `/api/csrf`                                                                   | GET                                 | Token bootstrap (the client helper handles it; UI never calls it directly)                                                                                                                          |

**Confirmed backend gaps** this plan must fill (P-U0b):

- No `GET /api/orgs/[orgId]/members` — the store has `listMembers` + `listPendingInvites`, but no route exposes them. The onboarding review screen and any members panel need it.
- No onboarding-completion persistence — nothing records "this user finished/skipped onboarding".

**Shell facts** (`/new` = `/projects/new`; `/` 308-redirects there permanently):

- Chrome lives in `app/projects/layout.tsx` (client): `Header` topbar + `<main>`; **no sidebar**. Screens wrap themselves in `ProjectsShellWithFreeTier` → `ProjectsShell` (title/headerContent/children/footer slots).
- Header nav = four callback props (no config array); in-page nav = the declarative `features/landing/domain/creation-path.ts` (`CREATION_PATH_OPTIONS`, `IMPORT_SUB_OPTIONS` with `status: "available" | "coming-soon"`, `CREATION_STEPS`) with a **route-existence ratchet test** (`creation-path.test.ts`: every `available` href must have a mounted `page.tsx`; `NOT_YET_ROUTED` list for the rest).
- Disabled-state prior art: `ImportOptionRow` renders `status: "coming-soon"` as a non-interactive row + pill; `CreationPathCard` (top-level cards) **has no disabled state today**.
- No screen inside `/projects/new` reads session. The only session façade is `ExternalIntegrationContext` → `{ isAuthenticated, signIn }`, and its `signIn` + all consumer copy mean "authorize GitHub _publish_", not "log in to the app".
- Existing `/auth/signin` (`SignInPage.tsx`) renders **outside** the shell, copy framed as publish-authorization; NextAuth `pages.signIn = "/auth/signin"`.

**`packages/ui` facts:** available primitives = Button, Input, Textarea, Checkbox, Card family, Badge, Label, Icon, Spinner, Skeleton, CopyButton, Tabs, Accordion, Tooltip, ViewToggle, FileDropZone, Dialog family (native `<dialog>`). **Missing:** Select/Radio, Stepper, Alert/Banner/Toast, Avatar/user-menu, form field composition, Progress. Constraints: every `*Props` must carry the `NoSemanticState` brand; **prop names `error`, `loading`, `status`, `data`, `result`, `isPending`… are banned** by the 3-layer firewall; tests are `.test.ts` (not `.tsx` — those are silently skipped) using `React.createElement` + `node:assert/strict`; only `@hexagen/ui` and `@hexagen/shared` imports allowed inside the package.

**Enforcement traps:** `features/*` slices cannot import each other (lint error + CI check 6; only `workspace-shell` exempt) — so onboarding **cannot** reuse `CreationStepIndicator` from `features/landing`. `components/` may not import `features/`. `app/**` is wired for **neither** Tailwind rule — the PR-Agent bot (DESIGN.md §4.7, scale `{1,2,3,4,6,8,12,16}`) is the only spacing gate there; several existing files it would be natural to copy (`ImportOptionRow`, `ProjectMenu`) contain §4.7 violations — copy structure, not spacing.

## 2. Design decisions

| ID       | Decision                            | Default and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-U1** | Auth-gating scope                   | **RESOLVED BY OWNER 2026-08-25: hard gate, free tier included.** Middleware requires a session JWT for every page and API, with an explicit allowlist: `/login`, `/auth/*`, `/api/auth/**` (also the deploy healthcheck target), `/api/csrf`, Next static assets. Pages redirect 307 to login with `callbackUrl`; APIs get a 401 JSON body. The frozen ADR-0063 routes are gated in FRONT (middleware), never edited. The 308-cached `/` → `/projects/new` is fine: that URL now bounces to login. `requiresAuth` nav data and disabled-state affordances shrink to a secondary role (flash-of-gated-content between hydration and redirect, and deep-link affordances) |
| **D-U2** | Where login lives                   | At **`/login`**, reusing the /projects chrome verbatim: the topbar+main composition is extracted to `features/workspace-shell/WorkspaceChrome` and both `app/projects/layout.tsx` and `app/login/layout.tsx` are thin wrappers over it (owner correction 2026-08-25: same shell by construction, separate route). NextAuth `pages.signIn` repoints to it; `/auth/signin` becomes a redirect (server component) so old links and the middleware's `callbackUrl` contract keep working. Copy is rewritten: this is **app sign-in** (accounts, orgs, saved work), not GitHub-publish authorization                                                                         |
| **D-U3** | Sign-in ≠ publish-authorization     | Same GitHub OAuth under the hood today (scope reduction is a flagged open decision — sign-in currently requests `repo workflow`). The _concepts_ separate now: a new `useAppSession()` hook (auth slice) for identity; `ExternalIntegrationContext` keeps publish semantics and its copy. No consumer of `isAuthenticated`-for-publish changes meaning                                                                                                                                                                                                                                                                                                                  |
| **D-U4** | Onboarding trigger                  | After first sign-in: signed in AND `onboarded_at IS NULL` → redirect (from the login landing logic, not middleware) into `/projects/new/onboarding/welcome`. Every step skippable; **Skip = complete** (stamps `onboarded_at`) — onboarding must never be a wall in front of a working personal tenant                                                                                                                                                                                                                                                                                                                                                                  |
| **D-U5** | Onboarding persistence              | Server-side `users.onboarded_at` (nullable TEXT, in-file migration style) + `POST /api/account/onboarding-complete`. Not localStorage: it must survive devices/browsers, and "has an org" is a wrong proxy (personal-tenant users would be re-onboarded forever)                                                                                                                                                                                                                                                                                                                                                                                                        |
| **D-U6** | Wizard mechanics                    | Route-per-step under `app/projects/new/onboarding/{welcome,workspace,org,team,invites,done}` mirroring the `/projects/new` flow (URL is the step state; `?param=` carries data; containers own `busy`/`validationMessage`; presentational components validate locally). **Not** the RHF `/wizard` machinery and **not** `@hexagen/wizard-orchestration` (its domain layer has zero consumers; only its mapping functions are real)                                                                                                                                                                                                                                      |
| **D-U7** | Shared component strategy           | Promote what two+ slices need into `packages/ui` (Stepper, Alert, FormField, Avatar/UserMenu) instead of a third app-local clone (`BrownfieldStepIndicator` already documents this promotion debt). Firewall-compliant prop names: `busy` not `loading`, `validationMessage`/`tone` not `error`/`status`                                                                                                                                                                                                                                                                                                                                                                |
| **D-U8** | Minimal tenant switcher is IN scope | Without it, an org created in onboarding is invisible afterward — the wizard would set up state the user cannot reach (§8 A5). Scope: a `TenantProvider` (client context: `activeTenantId`, list from `GET /api/orgs`) + Header user-menu section + adapters accepting a tenant. The _full_ switcher UX (per-surface org views) remains the sibling packet from the accounts plan                                                                                                                                                                                                                                                                                       |

## 3. Packets

**P-U0a — Client gateway for the accounts backend** · S
`app/lib/adapters/http-orgs.adapter.ts` in the house adapter style: constructor-injected fetcher defaulting to `fetchWithCsrf`, one `request()` mapping the `{error, message, statusCode}` body to typed results, never throws. Surface: `listOrgs`, `createOrg`, `deleteOrg`, `inviteMember`, `changeRole`, `removeMember`, `listTeams`, `createTeam`, team members, `listShared`. Mirrors the slug regex client-side but still handles the index-raised 409. Unit tests stub fetch recording URLs (RunHistoryPage precedent: assert the positive call _and_ the absence of the wrong one).

**P-U0b — Backend gaps** · S
`GET /api/orgs/[orgId]/members` (members + pending invites; org-member-only, owner sees roles) over the existing `listMembers`/`listPendingInvites`. `users.onboarded_at` migration + `POST /api/account/onboarding-complete` (idempotent) + the field on the session/`GET /api/orgs` bootstrap response so the client learns it in one round trip. House rules apply: audit inside the transaction where mutating, mutation-verified tests.

**P-U1 — `packages/ui` additions** · M
`Stepper` (generalized from `CreationStepIndicator`'s `{currentStep, steps}` shape), `Alert` (tone: info/success/warning/danger — semantic _style_, not semantic _state_; message is `children`), `FormField` (Label+control+`validationMessage` slot with `role="alert"`, `aria-describedby` wiring; fixes the `Label required`-prop DOM-attribute bug in passing), `Avatar` (image/initials) + `UserMenu` (composes existing disclosure pattern). All props branded `NoSemanticState`, banned prop names avoided, `.test.ts` tests, CVA for variants. Opportunistic fixes if trivial: `Skeleton`'s hardcoded `bg-gray-200` → token.

**P-U2 — Auth slice + login screen** · M · needs P-U1
New slice `features/account-onboarding/` (one slice for login + onboarding + tenant menu — they share components and slices can't import each other). `useAppSession()` (wraps `useSession` with the defensive destructure precedent). `LoginScreen`: `ProjectsShellWithFreeTier` card, "Continue with GitHub", correct copy (app sign-in; note that publishing uses the same GitHub identity), `callbackUrl` honored; signed-in visitors are bounced to `callbackUrl`/onboarding/`/projects`. Route `app/login/page.tsx` (server component; `<Suspense>` since the client reads `useSearchParams`); `pages.signIn` repointed (auth.test.ts pin updated deliberately); `/auth/signin` becomes a redirect.

**P-U3 — Hard auth gate + auth-aware chrome** · M · needs P-U2
Middleware becomes deny-by-default (D-U1): session JWT required everywhere except the allowlist (`/login`, `/auth/*`, `/api/auth/**`, `/api/csrf`, `_next/*` and static files). Pages 307 to login with `callbackUrl`; APIs answer 401 `{error:"unauthorized"}` — the SAME body shape `requirePersistenceOwner` uses, so `isUnauthenticatedPersistenceError` keeps matching. The CSRF guard stays layered after the auth check. **Rewrite** `middleware.test.ts` to pin the new policy (allowlist exact, everything else gated — including the previously-open generate APIs) with the reversal dated. Chrome: Header gains `Avatar`/`UserMenu` (account, sign out — today's only sign-out is buried in `/account`, theme, tenant section from P-U5); `ProjectsLandingShell`'s unconditional "Sign in" link becomes session-aware. ADR: a short ADR records the anonymous-tier retirement and ADR-0063's front-gating construction.

**P-U4 — Onboarding wizard** · L · needs P-U0a, P-U0b, P-U1, P-U2
Steps (each skippable; step ledger + throwing `stepIndexById`-style lookup + route-existence test mirroring `creation-path.test.ts`):

1. **Welcome** — identity confirmation (name/avatar/`github_login` from session).
2. **Workspace** — "Just me" (skip to done) vs "Create an organization".
3. **Org** — name+slug; client mirrors the regex; 409 → inline `validationMessage` ("taken — pick another"), no pre-check.
4. **Team** (optional) — first team in the created org.
5. **Invites** (optional) — GitHub handles; renders the 202 truthfully: _"Invited — they join when they next sign in"_, expiry shown; copy identical whether or not the handle has an account (anti-enumeration extends to UI copy).
6. **Done** — summary from `GET /api/orgs` + members listing; stamps `onboarded_at`; lands in the created org context (P-U5).
   Presentational components take `{busy, validationMessage, onSubmit, onBack}`; containers own state; created-org id flows forward via `?org=`. **Refresh-safety:** each step re-derives from the server (org step detects "already created" via the 409/list rather than double-creating).

**P-U5 — Minimal tenant switcher** · M · needs P-U0a; unblocks P-U4 step 6
`TenantProvider` in `app/contexts/` (neutral home): `activeTenantId` (default personal), org list, persisted selection (localStorage; validated against the fetched list — JWTs don't learn revocations, the list is the truth). `UserMenu` tenant section. `wire.client.ts` threads the tenant into `HttpSavedProjectsAdapter` (tenant-scoped routes exist); IDB cache stays personal-tenant-only (H1.7) — org tenants are server-only, no offline fallback.

**P-U6 — Tests, ratchets, docs** · S · last
Container tests on the stateful `nav-stub` (inert global router can't assert navigation); jsdom `<dialog>` shim where needed; a11y assertions (`aria-current="step"`, `role="alert"`, focus moved to heading on step change). Sweep: every pinned test knowingly changed (`middleware.test.ts`, `auth.test.ts` pages pin, creation-path ratchet) carries a comment naming this plan. DESIGN.md gains the auth-affordance pattern (§ addition). Update `docs/planning/README.md` index if present.

**Dependency graph**

```
P-U0a ─┬────────────────────────┬──▶ P-U4 ──▶ P-U6
P-U0b ─┤                        │
P-U1 ──┼──▶ P-U2 ──▶ P-U3 ──────┤
       └──────────▶ P-U5 ───────┘  (P-U5 before P-U4's Done step)
```

P-U0a/P-U0b/P-U1 are parallel-safe. Estimated: 2 S + 1 S + 3 M + 1 M + 1 L + 1 S.

## 4. Adversarial review

Attacks mounted against this plan, with verdicts.

**A1 — "You are walling off the product's front door."** `/` 308-redirects (browser-cached, permanent) to `/projects/new`; anonymous creation was the acquisition funnel. _Verdict: OVERRULED by owner decision 2026-08-25_ — the hard gate is the product intent, free tier included. The funnel cost is accepted; the mechanical concern that survives is redirect hygiene (`/projects/new` → login → back via `callbackUrl`, no loops), covered in P-U3's tests.

**A2 — "First sign-in mid-flow can eat local work."** `CachedSavedProjectsAdapter` wipes the IDB cache on owner mismatch and runs a one-time IDB→server lift; the gate changes _when_ users first authenticate, so the lift fires at new moments — e.g. mid-creation-flow with unsaved anonymous work. The client also string-matches the exact `"Sign in required"` message from `requirePersistenceOwner`. _Verdict: sustained, sharper under the hard gate._ Existing users hold anonymous IDB work today; after the gate they must sign in before reaching the shell, and the first signed-in load runs the IDB→server lift. Acceptance: pre-gate anonymous project → deploy gate → sign in → project lifted and visible (and cache-owner stamping verified); the `"Sign in required"` string coupling gets a comment on both sides plus a literal-pinning test.

**A3 — "JWT sessions make your gate lie."** `strategy: "jwt"`: sign-out elsewhere, account deletion, org-membership revocation — none invalidate an existing JWT; the switcher could show an org the user was just removed from until refresh. _Verdict: sustained as a known limit._ Mitigations: P-U5 revalidates the org list on window focus and treats 403s from tenant routes as "membership gone → drop to personal + toast". The real fix (session invalidation / DB-checked sessions) is the already-flagged owner decision (account deletion + JWT existence check pair) — explicitly out of scope here, cross-referenced.

**A4 — "The invite step will lie about what happened."** The backend returns a uniform 202 always — a naïve UI shows "member added" (false: nothing exists until their next sign-in) or, worse, differentiates copy by whether the handle is known (defeating the anti-enumeration property). _Verdict: sustained; designed in._ P-U4 step 5 copy is uniform and truthful; the member list separates **Members** from **Pending invites** (with expiry) via P-U0b's listing route; acceptance test asserts identical UI output for known/unknown handles.

**A5 — "Onboarding creates state the user can't see."** Without a tenant switcher, the created org is unreachable — the wizard ends in dead air. _Verdict: sustained._ P-U5 pulled into scope (D-U8); the Done step lands _inside_ the org context.

**A6 — "Your login screen over-asks."** Sign-in requests `read:user user:email repo workflow` — repo-write scopes at app login, for users who never publish. Consent-screen friction lands exactly where the funnel starts. _Verdict: sustained, deferred with a seam._ Scope reduction / incremental authorization is an open owner decision (predecessor plan). The login copy (P-U2) explains why GitHub scopes are requested; D-U3's session/publish split means the later scope work touches auth config, not this UI.

**A7 — "You will trip your own firewall."** New shared components with `error`/`loading`/`status` props are compile errors (NoSemanticState) + lint errors + CI failures; `.test.tsx` in `packages/ui` is silently skipped; slice isolation forbids reusing `CreationStepIndicator`; `components/` can't import `features/`; `app/**` spacing is bot-only. _Verdict: sustained; absorbed into the packet designs_ (P-U1 naming, promotion-over-clone, single-slice layout, spacing-bearing markup kept in `features/`+`components/`). These are stated as acceptance criteria, not hoped-for behaviors.

**A8 — "The wizard will double-create on refresh/back."** Route-per-step + URL params means re-POSTs are one refresh away. _Verdict: sustained._ Org/team creation are guarded by their unique indexes (409, not duplicates) — the UI treats 409-with-same-slug-you-just-made as "already created, continue"; invites are idempotent upserts server-side. Acceptance: a replay test per mutating step.

**A9 — "CSRF will 403 your own wizard."** Every onboarding mutation happens signed-in → session cookie present → the D-H7 middleware fires. A single stray `fetch()` POST fails only for signed-in users — the exact failure class the one-helper rule exists to prevent. _Verdict: accepted; enforced._ All mutations go through `postJson`/adapter (P-U0a); P-U6 adds a grep-style test asserting no bare `fetch(` with a mutating method in the new slice.

**A10 — "You're building on screens whose spacing is already illegal."** The natural copy-sources (`ImportOptionRow`, `ProjectMenu`) contain §4.7 violations (`mt-0.5`, `gap-1.5`, `py-1.5`); the bot will flag them in new code, and `no-off-scale-spacing` is error-level in `components/primitives/`. _Verdict: sustained._ "Copy structure, not spacing" is a stated rule in every UI packet; new code is written to the scale from the start.

**A11 — "Two sign-in meanings will produce wrong copy somewhere."** Consumer labels say "Sign in to GitHub" (publish); the new gate says "Sign in" (account). One shared `isAuthenticated` already flows through `GithubPublishContext` into menus. _Verdict: sustained._ D-U3 splits the hooks; P-U3 audits every `isAuthenticated` consumer and every "Sign in" label for which meaning it needs. The audit list (7 surfaces, from the auth exploration) is the checklist.

\*_A12 — "The permanent redirect makes `/` unusable as a login landing."_ Any plan step that says "put login at `/`" fights a 308 cached in every returning visitor's browser. _Verdict: sustained; avoided by design_ — login lives under `/login`; nothing targets `/`.

**A13 — "Middleware can't do real auth anyway."** Edge runtime, no better-sqlite3: middleware can check JWT presence, never membership/tenant validity. A user removed from an org passes middleware and must be stopped by `requireTenant` in routes. _Verdict: accepted; already the architecture._ The UI gate is UX; the security boundary remains the route handlers (unchanged by this plan). Stated so nobody later "hardens" middleware with a DB call.

**A14 — "Your own ratchet tests will fail your PRs."** `creation-path.test.ts` fails on any nav entry without a mounted route; `auth.test.ts` pins `pages.signIn`; `middleware.test.ts` pins the open paths. _Verdict: accepted; scheduled_ — each pinned test is updated in the same packet that changes its subject, with the reversal comment (P-U3/P-U6), never loosened in a separate "fix the tests" commit.

**A15 — "Skippable onboarding means nobody onboards; mandatory onboarding means churn."** _Verdict: accepted trade-off._ D-U4 chooses skippable-and-stamped: the wizard is reachable later (UserMenu → "Set up an organization" reopens it), so skipping costs nothing permanent. Measuring completion is out of scope (no product analytics exist).

## 5. Out of scope (with pointers)

- OAuth scope reduction / incremental auth — open owner decision (predecessor plan).
- Account deletion + JWT existence check — must ship as a pair; owner decision.
- Ownership transfer packet — approved separately (accounts plan follow-up).
- Full per-surface org UX (org-scoped project lists everywhere, members management page beyond the wizard's) — the accounts plan's "client tenant switcher" packet proper; P-U5 here is its minimal kernel.
- Quota re-keying from `hxg_sid` cookie to user ids (metering keeps functioning behind the gate; unifying keys changes limit semantics per-browser → per-account and is an owner decision). ADR-0063's files stay frozen — the gate lives in front of them.
- Email/password or non-GitHub identity providers.

## 6. Verification obligations (roll-up)

- Every pinned/ratchet test changed knowingly, with a dated comment naming this doc: `middleware.test.ts`, `auth.test.ts` (`pages.signIn`), `creation-path.test.ts`.
- Mutation-verified tests for P-U0b's backend pieces (house rule).
- A2's sign-in-transition test (IDB lift + cache-owner stamp survive the new gate).
- A4's uniform-copy test (known vs unknown handle → identical rendering).
- A8's replay test per mutating wizard step.
- A9's no-bare-fetch check in the new slice.
- `yarn validate:boundary` + `lint:arch` + full `apps/web` vitest green per packet; PR-Agent bot review addressed per packet (it is the only §4.7 gate for `app/**`).

---

## Status — 2026-08-26: ARC COMPLETE

All packets landed on main, each squash-merged after full-green CI and a swept review round (accepted findings fixed with mutation-verified tests; refuted findings answered with repo evidence):

| Packet                                           | PR                   | Squash                  |
| ------------------------------------------------ | -------------------- | ----------------------- |
| P-U2 login (`/login` + WorkspaceChrome)          | #660 (+ hotfix #665) | `f6ce5ef2` / `9f62a912` |
| P-U3 hard auth gate (ADR-0070)                   | #661                 | `fe458ad9`              |
| P-U0a orgs client gateway                        | #662                 | `e6b10f29`              |
| P-U0b members listing + `onboarded_at`           | #663                 | `1d6fc35e`              |
| P-U1 ui primitives                               | #664                 | `43045701`              |
| P-U5 tenant switcher (+ tenant GET gap fix)      | #666                 | `9b10483b`              |
| P-U4 onboarding wizard                           | #667                 | `197aabcb`              |
| P-U6 sweep (this doc + Done-step tenant handoff) | —                    | this PR                 |

Deviations from the written plan, all recorded in the PRs: login lives at `/login` reusing the chrome via `WorkspaceChrome` (owner correction); the onboarding endpoint is `GET/POST /api/account/onboarding`; the tenant collection route needed a GET (found in P-U5); `TenantMenu` subsumed the planned `UserMenu`.

Open follow-ups (owner decisions, unchanged): OAuth scope reduction; account deletion + JWT existence check pair; quota re-keying (`hxg_sid` → user id); ownership-transfer packet; full per-surface org UX beyond the minimal switcher.
