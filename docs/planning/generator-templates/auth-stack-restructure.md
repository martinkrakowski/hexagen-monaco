# Auth Stack Restructure: Trim Auth-Mock & Per-Provider Middleware

**Branch:** `feature/auth-stack-restructure`
**Status:** Proposed (design)
**Relates to:** [03-auth-mock.md](./03-auth-mock.md), [04-auth-providers.md](./04-auth-providers.md), [05-supabase.md](./05-supabase.md), [engine-gated-outputs.md](./engine-gated-outputs.md)

---

## Problem

`auth-mock` was designed as a uniform provider contract: a `UserContext` value
object, an `AuthProviderPort` interface, a real-mode middleware reading a
session-token cookie, and a `RealAuthAdapter` stub that each provider
overwrites. In practice, the abstraction has cost more than it earns:

- **It rarely fits modern providers.** Group B (NextAuth, Clerk, Better Auth)
  opted out by listing `auth-mock` in `conflicts`; Supabase's `use_auth_mock`
  integration (#105) is non-functional in real mode without a custom dual-cookie
  sync. Only Group A (Hexagen-rolled session over an opaque token cookie) fits
  the contract.
- **It hid a correctness bug.** Group A providers were silently broken until
  PR #106 — the emitter's conflict-detection treated the cross-template stub
  override as a user modification and wrote a `.hexagen-update` file, so
  `AUTH_MODE=real` kept routing through `RealAuthAdapter`'s throwing stub.
  An abstraction whose net effect is hiding bugs is over-engineering.
- **It imposes cognitive load.** Every consumer learns `AUTH_MODE`,
  `AuthProviderPort`, `AuthService`, the `RealAuthAdapter` stub-override pattern,
  and the auth-mock middleware contract — to satisfy a promise (swap providers
  without touching app code) that almost no project ever cashes in.

## Goal

Shrink `auth-mock` to its high-value core (a shared `UserContext` type + a
small dev-mode mock) and have each real provider ship its own middleware and
helpers, idiomatic to that provider's actual session model. Drop the
`AuthProviderPort` contract and the `RealAuthAdapter` stub-override pattern.

---

## What auth-mock keeps (the high-value core)

- `src/domain/value-objects/user-context.ts` — `UserContext` shared type.
  Application code depends on this, not on `Supabase.User` / `Session` / etc.
- `MOCK_USER` constant for development and tests.
- `AUTH_MODE=mock` toggle and a tiny mock middleware: when set, injects
  `MOCK_USER` as the request user (e.g. `x-user-context` header) so feature
  development works without a real provider configured.

## What auth-mock drops

- `AuthProviderPort` interface (`src/domain/ports/out/auth-provider.port.ts`).
- `AuthService` (`src/application/services/auth.service.ts`).
- `RealAuthAdapter` stub at `src/infrastructure/auth/real/real-auth.adapter.stub.ts`
  — no more cross-template override pattern.
- Real-mode `server/middleware/auth.middleware.ts` (the one that 401s when its
  own session cookie is missing — the source of the Supabase mismatch).
- `src/infrastructure/auth/session/session-manager.ts` (sessions are
  provider-specific now).
- `app/api/auth/me/route.ts` and `app/api/auth/logout/route.ts` (provider-specific).
- `AUTH_MODE=real` — `auth-mock` no longer needs to know about real mode.
  Each provider's own middleware decides.

The trimmed `auth-mock` becomes ~3 files: `user-context.ts`, `mock-user.ts`,
and `dev-mock.middleware.ts` (only active when `AUTH_MODE=mock`).

---

## Per-provider responsibilities

Each real provider ships an **idiomatic end-to-end auth pattern** matched to
its session model. No common port; each provider's middleware, helpers, and
routes are tuned to its actual cookies and validation flow.

### Group A — Hexagen-rolled sessions (5 templates)

`google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa`.

Each already owns its session-store (AES-256-GCM stateless session). They
additionally absorb the pieces currently delegated to `auth-mock`:

- `middleware.ts` — reads its session cookie via the existing session-manager,
  validates, gates `protected_paths`, sets `x-user-context`.
- `src/lib/auth/get-current-user.ts` + `require-auth.ts` — for server actions
  and route handlers.
- `app/api/auth/me/route.ts` — returns `UserContext` from this provider's session.
- `app/api/auth/logout/<provider>/route.ts` — already in place; signature stays `DELETE`.

They **drop**:

- Emitting `real-auth.adapter.stub.ts`.
- Importing from `AuthProviderPort` / `AuthService` (provider helpers call into
  the provider's own session-store directly).

They **keep** `requires: ["auth-mock"]` — but only for the `UserContext` type
and the dev-mock fallback. No port contract dependency.

### Group B — Standalone frameworks (3 templates)

`nextauth`, `clerk`, `better-auth`.

**No change.** They already opt out via `conflicts: ["auth-mock", ...]` and
ship their own middleware. The `Standalone` note in the wizard stays accurate.

### Supabase (#05)

- Ships `middleware.ts` using `@supabase/ssr` (gated on
  `features` includes `auth`). Refreshes session cookies per request per
  Supabase's official SSR pattern.
- Drops `use_auth_mock` question, `SupabaseAuthAdapter`,
  `real-auth.adapter.stub.ts`. The architectural mismatch from #105's review
  goes away because the bridge no longer exists.
- Existing `src/infrastructure/supabase/auth/get-user.ts` and `require-auth.ts`
  already follow Supabase's `getUser()` (server-validated) recommendation — no
  change.

---

## Engine implications

None. This is a template-level reshape. The cross-template override fix
(PR #106) actually becomes **less load-bearing** after this restructure —
nothing in the trimmed model relies on one template's emission overwriting
another's. The fix stays in (it's correct), but its primary motivating case
disappears.

---

## Migration plan

Two viable shapes:

### A. Coordinated bulk PR (recommended)

One PR that:

1. Trims `auth-mock` to the 3-file core.
2. Adds middleware/helpers/me-route to each of the 5 Group A templates.
3. Removes Supabase's `use_auth_mock` + adapter + stub; adds the
   `@supabase/ssr` middleware.

Larger surface but a coherent state at the end — the auth stack is consistent
across all providers in one go. Justified because the alternative is six
partially-broken intermediate states (each Group A template requiring a coordinated
auth-mock change to compile).

### B. Sequenced via parallel "auth-base"

1. Introduce a new tiny `auth-base` template (= the trimmed `auth-mock`).
2. Per-provider PRs migrate each provider to `requires: ["auth-base"]` and absorb
   its own middleware/helpers. Old `auth-mock` stays installable for back-compat.
3. After all providers migrate, deprecate `auth-mock`.

Slower but each PR is small and reversible. Cost: temporarily two near-duplicate
foundation templates and a long deprecation window.

**Recommendation:** A. There are no real downstream consumers to coordinate with
(this is a generator, not a published library), and the current auth-mock model
has a known design problem we don't want to leave standing.

---

## Backward compatibility

This is a **breaking change** for any project already generated with `auth-mock`
in its `AUTH_MODE=real` configuration. For projects on `AUTH_MODE=mock`, the
mock middleware behaves the same. Projects can regenerate templates after the
migration (the emitter's user-modification protection still applies to anything
they changed).

The merged Group A templates were arguably already broken (pre-#106), so this
restructure replaces a working-as-of-#106 state with a more correct one — not
working state with breakage.

---

## Open questions

1. **`AUTH_MODE=mock` retention.** Do we keep the toggle, or push each provider
   to ship its own dev story (Supabase `supabase start`; Clerk dev keys; magic
   link with console-log transport)? The mock has small carrying cost and clear
   value for early-stage prototyping — recommend keeping it.
2. **Where `UserContext` lives.** In trimmed `auth-mock` is simplest (all
   providers `requires: ["auth-mock"]` anyway). Could move to its own
   `user-context` template if we want zero auth-mock dependency for Group B,
   but that's three providers' worth of `requires` plumbing for one type
   definition.
3. **`UserContext` shape vs. provider-specific user data.** Clerk has
   organisations + custom session claims; Supabase has `app_metadata` /
   `user_metadata`; Group A providers each have their own profile fields. Do
   we add optional fields (`organizationId?`, `metadata?: Record<string, unknown>`)
   or let each provider extend `UserContext` with its own type intersection?
4. **What replaces the `provider` answer in templates' descriptions.** Several
   manifests reference "the real auth provider" — wording needs to update to
   reflect that there is no longer a slot.

---

## Scope

Six template changes:

- `auth-mock` (trim).
- 5 Group A providers (add middleware + helpers + drop stub).
- Supabase (drop `use_auth_mock`, add `@supabase/ssr` middleware).

No engine changes. No new tests required at the engine level; per-template
emit verification (the matrix pattern used in #103/#105) covers the reshape.

## Follow-ups enabled

- Cleaner conflict semantics in the wizard catalog: `auth-mock` no longer
  needs to be in any provider's `conflicts` list (it's just a type module).
- Simpler `04-auth-providers.md` doc: drop the "Group A vs Group B" distinction
  — the only meaningful distinction was "uses auth-mock's contract or not,"
  which disappears.
- The "Standalone" note we added to Group B's wizard tiles can probably be
  retired (or kept just to flag "owns its own auth UI").
