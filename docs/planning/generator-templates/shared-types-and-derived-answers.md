# Shared Types Extraction, Template Split & Derived Answers

**Implementation branch:** `feature/shared-types-and-derived-answers` (proposed)
**Status:** Proposed (design v3 — revised after two rounds of review)
**Relates to:** [03-auth-mock.md](./03-auth-mock.md), [04-auth-providers.md](./04-auth-providers.md), [05-supabase.md](./05-supabase.md), [auth-stack-restructure.md](./auth-stack-restructure.md), [engine-gated-outputs.md](./engine-gated-outputs.md)

---

## Problem

Three deferred items from PR #108 share one root cause: **the template system has no clean way to share types and runtime helpers across templates, no way to express "this dependency only applies in some configurations", and an underused mechanism for derived answers.** The naïve workaround (require everything, emit dead code, ask irrelevant prompts) breaks down in three concrete spots:

### Item A — Phantom `auth-mock` requirement on storage-only Supabase

`supabase` declares `requires: ["env-setup", "auth-mock"]` so that `UserContext`, `MOCK_USER`, and session-cookie helpers are available when `features ⊇ {auth}` (Supabase's gated middleware imports them). When `features` does **not** include `"auth"`, Supabase emits zero auth code — but auth-mock's outputs ride along anyway:

```text
src/domain/value-objects/user-context.ts          (unused)
src/infrastructure/auth/mock-user.ts              (unused)
src/infrastructure/auth/session/session-manager.ts (unused)
middleware.ts                                     (no-op pass-through)
.env.auth.example                                 (unused vars in .env)
```

~5 files / ~150 LOC of dead weight in a storage-only Supabase install. Plus four wizard questions (`session_cookie_name`, `mock_user_*`) the user answers for nothing.

### Item B — Underused `auto` / `derivedFrom` question type

The engine already supports an `auto`-typed question that derives its answer from another template's question (`packages/template-engine/src/domain/question.ts:40-46`). The CLI install resolves it correctly (`add-template.use-case.ts:107-116`). The schema validates it. The CLI's `templates info` formats it as `[auto: derived from X]`. **No template uses it.**

The recent double-prompt fix (PR #108) — provider manifests asking `session_cookie_name` on top of auth-mock asking it — was patched by _removing_ the question from providers and hardcoding `"__auth_session"` as the fallback. The cleaner answer is `auto + derivedFrom`, declined only because no precedent existed yet.

### Item C — Drift surface in provider cookie-name fallbacks

`session-manager.ts` (emitted by auth-mock today) owns the canonical cookie-name resolution. Every Group A provider's `get-current-user.ts` re-implements the same logic with a hardcoded fallback. Five copies of the same constant; the day someone configures a non-default cookie name, provider helpers will read the wrong cookie.

### Side observation — PR #108's gated conflicts are dormant

While planning this work, the v2 review surfaced that `add-template.use-case.ts:49` calls `resolveDependencies(templateIds, manifestMap)` **without** an `answers` argument. Answers are collected later, inside the install loop (line 63). Per the engine's conservative default ([`output-gating.ts:matchesCondition`](../../packages/template-engine/src/domain/output-gating.ts)) missing answers → gate inactive — so every gated conflict shipped in PR #108 is currently unenforced. Supabase's eight `{ id, when: features⊇auth }` entries are inert.

This is **not** introduced by this plan; it is pre-existing dormant code. It does, however, eliminate any symmetry argument for adding a third gated mechanism (gated `requires`): the other two aren't actually enforced either. This plan therefore takes a different shape than the v2 draft — **no schema extension**.

How to resolve the dormant code (refactor the use case to two-phase collect-then-resolve, or roll back the schema features) is a separate decision tracked elsewhere; see _Out of scope_ below.

---

## Goal

1. Extract a `shared-types` template containing `UserContext`, `MOCK_USER` (with static default values, env-overridable at runtime), and the session-cookie helpers (`COOKIE_NAME` re-export included). One template, one source of truth.
2. **Split Supabase** into `supabase` (storage/database, no auth) and `supabase-auth` (auth provider, statically requires supabase + shared-types + auth-mock). Static dependency graph — no gating required for item A.
3. Adopt the existing `auto` / `derivedFrom` mechanism for `session_cookie_name` to eliminate duplicate prompts and codify the pattern for future shared answers.
4. Hide `auto` questions from the wizard's prompt list; surface them in the Summary step with a source annotation.

Net effect: storage-only Supabase emits exactly zero auth files. Auth-using Supabase imports `MOCK_USER` and `UserContext` from a stable single location. All five Group A providers gain a centralized cookie-name resolver. The engine grows zero new schema features. Mock-user prompts disappear from production OAuth installs.

---

## Design

### `shared-types` template (new, tiny)

```text
packages/template-engine/templates/shared-types/
  manifest.json
  files/
    src/domain/value-objects/
      user-context.ts          # UserContext interface + hasRole helper
    src/infrastructure/auth/
      mock-user.ts             # MOCK_USER constant: static defaults, env-overridable
      session/
        session-manager.ts     # COOKIE_NAME (exported), readSessionToken, buildSessionCookieHeader, buildClearSessionCookieHeader
```

Manifest:

```json
{
  "id": "shared-types",
  "name": "Shared Types",
  "description": "Foundation library shared by every auth template: UserContext domain type, a runtime-overridable MOCK_USER for development, and generic AES-256-GCM session-cookie helpers (including the canonical COOKIE_NAME resolver). Carries no opinion about mock vs. real auth.",
  "version": "1.0.0",
  "requires": ["env-setup"],
  "conflicts": [],
  "questions": [
    {
      "id": "session_cookie_name",
      "type": "text",
      "prompt": "Session cookie name? (used by the session-manager cookie helpers)",
      "default": "__auth_session"
    }
  ],
  "envVars": [
    "AUTH_COOKIE_NAME",
    "AUTH_SESSION_MAX_AGE",
    "MOCK_USER_ID",
    "MOCK_USER_NAME",
    "MOCK_USER_EMAIL",
    "MOCK_USER_ROLES",
    "MOCK_USER_AVATAR_URL"
  ],
  "outputs": [
    "src/domain/value-objects/user-context.ts",
    "src/infrastructure/auth/mock-user.ts",
    "src/infrastructure/auth/session/session-manager.ts"
  ],
  "checklist": [
    "UserContext is the domain-owned shape every auth provider speaks (id, email, name, roles, avatarUrl)",
    "MOCK_USER defaults are hardcoded in mock-user.ts; runtime overrides via MOCK_USER_* env vars",
    "session-manager.ts exports COOKIE_NAME — import from here, don't re-derive in provider code"
  ]
}
```

**One question**, not four. `mock_user_name` / `mock_user_email` / `mock_user_roles` move to static code defaults inside `mock-user.ts`:

```ts
// shared-types/files/src/infrastructure/auth/mock-user.ts
import type { UserContext } from "../../domain/value-objects/user-context";

// Static defaults — runtime overrides via MOCK_USER_* env vars. These are
// development helpers, not configuration; embedding them as install-time
// prompts forces every production OAuth installer to answer questions
// about mock users they will never use.
export const MOCK_USER: UserContext = {
  id: process.env.MOCK_USER_ID ?? "00000000-0000-0000-0000-000000000001",
  name: process.env.MOCK_USER_NAME ?? "Demo User",
  email: process.env.MOCK_USER_EMAIL ?? "demo@example.com",
  roles: (process.env.MOCK_USER_ROLES ?? "user")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean),
  avatarUrl: process.env.MOCK_USER_AVATAR_URL,
};
```

`session-manager.ts` exports `COOKIE_NAME` (today it's a module-local constant):

```ts
export const COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME ?? "{session_cookie_name}";
```

### Template split: `supabase` (storage-only) + `supabase-auth` (auth addon)

The reviewer's Alternative A: keep the dependency graph static by splitting Supabase into two templates.

**`supabase` v3.0** — storage / database / RLS / Drizzle / type generation. Zero auth deps.

```json
{
  "id": "supabase",
  "name": "Supabase",
  "description": "SSR-safe browser/server/admin clients, Result-based storage helpers, RLS examples, type generation, optional Drizzle ORM and realtime. Pure storage/database layer — no auth code. Add the supabase-auth template to layer @supabase/ssr-based session middleware on top.",
  "version": "3.0.0",
  "requires": ["env-setup"],
  "conflicts": [],
  "questions": [
    /* project_url, anon_key, features (without "auth"!), storage_buckets, orm, type_gen, rls_examples, realtime_example */
  ],
  "outputs": [
    /* all the existing storage/db/orm/realtime outputs — no middleware.ts, no src/lib/auth/*, no /api/auth/me */
  ]
}
```

Changes from current Supabase (v2.0):

- Drop `auth` from `features` options (it's now its own template).
- Drop `requires: ["auth-mock"]` (no auth files emitted here).
- Drop all 8 conflicts (storage coexists with any auth provider).
- Drop the auth-gated outputs (middleware.ts, src/lib/auth/get-current-user.ts, src/lib/auth/require-auth.ts, app/api/auth/me/route.ts).
- Drop `protected_paths` question (moves to supabase-auth).

**`supabase-auth` v1.0** — new template.

```json
{
  "id": "supabase-auth",
  "name": "Supabase Auth",
  "description": "Authentication provider built on Supabase: @supabase/ssr root middleware that refreshes the session and protects configured paths, getCurrentUser/requireAuth helpers, and /api/auth/me — all honouring AUTH_MODE=mock as a dev short-circuit.",
  "version": "1.0.0",
  "requires": ["supabase", "shared-types", "auth-mock", "env-setup"],
  "conflicts": [
    "nextauth",
    "clerk",
    "better-auth",
    "google-oauth",
    "github-oauth",
    "microsoft-entra",
    "magic-link",
    "adobe-ims-spa"
  ],
  "questions": [
    {
      "id": "protected_paths",
      "type": "text",
      "prompt": "Path prefixes the middleware should require auth for (comma-separated)?",
      "default": "/dashboard,/api/protected"
    }
  ],
  "envVars": [],
  "outputs": [
    "middleware.ts",
    "src/lib/auth/get-current-user.ts",
    "src/lib/auth/require-auth.ts",
    "app/api/auth/me/route.ts"
  ],
  "checklist": [
    "Sign-in/sign-up wiring is your responsibility — use supabase.auth.signInWithPassword / signInWithOAuth from the supabase template's client",
    "Set AUTH_MODE=mock in development; middleware short-circuits to MOCK_USER from shared-types",
    "getCurrentUser uses Supabase's server-validated getUser() — never authorize off getSession() locally"
  ]
}
```

The conflicts list is **unconditional plain strings**: supabase-auth always ships its middleware, so it always conflicts with every other auth provider. No gates, no execution-order problem, fires correctly at install time.

### `auth-mock` slims to dev-middleware-only

```text
packages/template-engine/templates/auth-mock/
  manifest.json
  files/
    middleware.ts            # AUTH_MODE=mock dev short-circuit + NODE_ENV guard
    .env.auth.example
```

Manifest:

```json
{
  "id": "auth-mock",
  "name": "Auth Mock",
  "description": "Dev-only root middleware that injects shared-types' MOCK_USER as x-user-context when AUTH_MODE=mock. Real auth providers ship their own middleware that overwrites this one and still honours AUTH_MODE=mock as a dev short-circuit.",
  "version": "3.0.0",
  "requires": ["shared-types", "env-setup"],
  "conflicts": [],
  "questions": [
    {
      "id": "session_cookie_name",
      "type": "auto",
      "derivedFrom": "shared-types.session_cookie_name"
    }
  ],
  "envVars": ["AUTH_MODE"],
  "outputs": ["middleware.ts", ".env.auth.example"],
  "checklist": [
    "Set AUTH_MODE=mock in development; the middleware injects MOCK_USER from shared-types",
    "MOCK_USER and its env-var overrides are configured in shared-types"
  ]
}
```

The `auto` question lets `middleware.ts` interpolate `{session_cookie_name}` consistently without re-asking. The CLI install (`add-template.use-case.ts:107-116`) already resolves this from the previously installed `shared-types` record. **This is the first template to actually use `auto + derivedFrom`** — landing it validates the schema feature end to end.

`middleware.ts` imports `MOCK_USER` from the shared-types-owned path (`./src/infrastructure/auth/mock-user`). Because `shared-types` is a required dep, the file is always present.

### Group A providers — add shared-types, drop fallbacks

Each of the five Group A providers:

- `requires: ["shared-types", "auth-mock", "env-setup"]` (adds `shared-types`).
- Drops the local `const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session"` from `get-current-user.ts`.
- Imports the canonical resolver: `import { COOKIE_NAME } from "../../infrastructure/auth/session/session-manager"`.

`MOCK_USER` is already imported from `../../infrastructure/auth/mock-user` in current code; that path is unchanged because shared-types emits there.

Conflicts arrays gain `"supabase-auth"` (replacing the gated `supabase` entry that's currently dormant); Group B (nextauth/clerk/better-auth) likewise gain `"supabase-auth"`.

### Wizard — hide `auto` questions

`apps/web/features/project-wizard/steps/TemplateQuestionsStep.tsx` (per-template prompt list) filters out `q.type === "auto"`. Auto answers still appear in the Summary step, annotated `"(derived from <source>.<question>)"` so users can see where each answer came from before committing.

No new rendering primitive; just `questions.filter(q => q.type !== "auto")` before mapping to UI rows, and one annotation rule in the Summary's answer renderer.

### Wizard — surface supabase-auth on the Supabase tile

Today users pick "Supabase" and see a `features` multiselect including `auth`. With the split, the Supabase tile's `features` no longer offers `auth`; instead, the catalog shows a sibling **Supabase Auth** tile in the `auth` category. The dependency is in the manifest (`supabase-auth` requires `supabase`), so selecting Supabase Auth auto-selects Supabase via the existing dependency-resolver UI affordance.

Optional polish for a future PR: a "Used with: Supabase" badge on the Supabase Auth tile, and a "Layer auth?" call-to-action on the Supabase tile that toggles Supabase Auth. Not required for correctness.

---

## Migration plan

### Step 1 — Create `shared-types`

- New directory `packages/template-engine/templates/shared-types/`.
- Move `auth-mock/files/src/domain/value-objects/user-context.ts` → `shared-types/files/...`.
- Move `auth-mock/files/src/infrastructure/auth/mock-user.ts` → `shared-types/files/...`; hardcode the static defaults (drop the `{mock_user_name}` etc. placeholders since the questions go away).
- Move `auth-mock/files/src/infrastructure/auth/session/session-manager.ts` → `shared-types/files/...`; **add `export` to `COOKIE_NAME`**.
- Write the manifest above. Ships as `v1.0.0`.

### Step 2 — Trim `auth-mock` to v3.0

- Drop the moved outputs from the manifest.
- Drop the three `mock_user_*` questions plus the `session_cookie_name` text question.
- Add `requires: ["shared-types", "env-setup"]`.
- Add the `auto`-typed `session_cookie_name` derived from shared-types.
- `middleware.ts` keeps its current content; the import path for `MOCK_USER` doesn't change.

### Step 3 — Split Supabase

- Bump current `supabase` to v3.0:
  - Drop `auth` from `features` options.
  - Drop `auth-mock` from `requires`.
  - Drop all 8 entries from `conflicts`.
  - Drop the four auth-gated outputs.
  - Drop `protected_paths` question.
  - Description updated to "pure storage/database layer".
- Create `supabase-auth` v1.0:
  - Static requires; unconditional conflicts; the four auth files emitted under this template's roof now.
  - Files moved from the current `supabase/files/middleware.ts`, `supabase/files/src/lib/auth/*`, `supabase/files/app/api/auth/me/route.ts` over to `supabase-auth/files/...`.

### Step 4 — Group A provider updates (5 templates)

For each of google-oauth, github-oauth, microsoft-entra, magic-link, adobe-ims-spa:

- Add `"shared-types"` to `requires`.
- Add `"supabase-auth"` to `conflicts` (replacing the formerly-gated `"supabase"` mention; today they don't list either explicitly because PR #108 declared it only on Supabase's side).
- In `files/src/lib/auth/get-current-user.ts`: drop the local `COOKIE_NAME`; `import { COOKIE_NAME } from "../../infrastructure/auth/session/session-manager"`.

Group B providers (nextauth, clerk, better-auth) gain `"supabase-auth"` in their conflicts lists to match.

### Step 5 — Wizard adoption

- `apps/web/features/project-wizard/steps/TemplateQuestionsStep.tsx` (or equivalent): filter `q.type === "auto"` before rendering the prompt list.
- Summary step: annotate auto entries with `"(derived from <source>.<question>)"`.
- `template-catalog.ts`: add a new entry for `supabase-auth` in the `auth` category; update the Supabase entry to drop the auth-feature line and to point users at Supabase Auth.

### Step 6 — Tests

Engine:

- `__tests__/application/auto-question-resolution.test.ts` (new) — end-to-end: install shared-types with a non-default cookie name; install auth-mock; verify auth-mock's `session_cookie_name` resolves to shared-types' answer, not the default.

Integration:

- `__tests__/templates/supabase-storage-only-emit.test.ts` (new) — install `supabase` alone; assert exactly the storage/db outputs are emitted; assert `user-context.ts` / `mock-user.ts` / `session-manager.ts` / `middleware.ts` / `.env.auth.example` are all absent. Hard guarantee against regressions.
- `__tests__/templates/supabase-auth-full-stack-emit.test.ts` (new) — install `supabase-auth`; assert supabase, shared-types, and auth-mock are auto-resolved; assert the full auth file set is emitted.
- `__tests__/domain/conflict-symmetry.test.ts` (extended) — re-verify the conflict matrix after the supabase split: supabase-auth conflicts with all auth providers; Group A + Group B list supabase-auth.

Existing Supabase tests that reference auth files need to move from the `supabase` test surface to the `supabase-auth` test surface.

### Step 7 — Docs

- New: this plan doc.
- Update `03-auth-mock.md` to reflect v3 (middleware-only) scope.
- Update `04-auth-providers.md` to list `shared-types` in the shared `requires`.
- Update `05-supabase.md`: storage-only by default; auth section points at the new `supabase-auth` template. Remove the deferred trade-off section.
- New: `docs/planning/generator-templates/15-supabase-auth.md` (parallel structure to other provider docs).
- Update the JOB-INDEX with the split entry and the new template numbering.
- Update memory note `project_generator_templates.md` to reflect 16 templates instead of 15.

### Step 8 — Optional follow-ups (NOT in this PR)

- Resolve PR #108's dormant gated conflicts: either refactor `add-template.use-case.ts` to two-phase collect-then-resolve, or roll back the schema features. Tracked as a separate decision; out of scope here so this PR doesn't conflate "ship the split" with "redesign the resolver".

---

## Out of scope

- **Gated `requires`** — proposed in v2; dropped here because the execution-order paradox affects it (and the existing gated conflicts) identically. Re-open once the resolver is two-phase.
- **Resolving PR #108's dormant gated conflicts** — see Step 8. Separate decision.
- **Discovery polish on the wizard** ("Layer auth?" CTA on the Supabase tile) — UX nice-to-have for after the split lands.
- **Sign-in/sign-up routes for supabase-auth** — the auth template ships only the validation/redirect plumbing; the actual sign-in flow is app-specific and left to the consumer per Supabase's recommended pattern.

---

## Trade-offs

### What this buys

- **Storage-only Supabase ships zero auth files.** Closes the deferred CodeRabbit thread cleanly. Hard-asserted by a regression test.
- **Static dependency graph throughout.** No execution-order risk; `resolveDependencies` works on a fully-known graph at use-case start.
- **`UserContext` and `MOCK_USER` live in one place** (shared-types), declared by their concept (shared domain), not by `auth-mock` (the mock middleware). No compile-time trap on conditional auth-mock.
- **Cookie-name resolution centralized**: `COOKIE_NAME` re-exported from session-manager; provider helpers stop re-implementing the fallback. Eliminates a five-copy drift surface.
- **Mock-user prompts vanish from production OAuth installs.** Three irrelevant questions per Group A install gone; runtime override via env vars unchanged.
- **First real consumer of `auto + derivedFrom`.** Validates the schema feature, exercises the wizard hide-auto rule, gives future templates a documented pattern.
- **Zero schema change.** No new gating primitives; no risk of adding another dormant feature.

### What this costs

- **Two Supabase templates** instead of one. Users discover them separately; the wizard catalog grows by one tile in the `auth` category. Counterpoint: Group A already lives that way (one provider = one template) — Supabase Auth simply joins the pattern.
- **`auth-mock` becomes very thin** (2 files). Some may argue it's now too small. Counterpoint: the dev short-circuit is a coherent opt-in concept; smallness reads as focus, not under-engineering.
- **A new transitive dep** for Group A providers (`shared-types` via `auth-mock` → `shared-types` directly). Practically invisible — the install graph just gets one more node; no new user prompts (mock-user prompts removed at the same time).
- **One question on shared-types** (`session_cookie_name`). Visible to anyone who installs shared-types alone (rare in practice), trivial to answer.
- **Existing PR #108 test coverage** for Supabase's gated conflicts needs to move to `supabase-auth`'s unconditional conflicts. The gated-conflicts engine code stays for now (harmless dormant), tracked as out-of-scope cleanup.

### Alternatives considered

- **Gated `requires`** (v2 of this plan): rejected per the execution-order paradox. The resolver runs before answers exist, so gated deps would silently drop. Refactoring the use case to two-phase resolution cascades into the interactive prompt loop and is a larger redesign than the problem warrants.
- **Inline duplication** (each provider ships its own UserContext at the same path; cross-template scan handles it): rejected. Fragments the source of truth on a domain contract type; downstream code that casts UserContext-shaped values would silently drift.
- **Wizard-level conditional rule** (special-case Supabase in `findConflicts`): rejected. Special cases for one template are how this codebase grew the abstractions PR #108 just removed.
- **Static defaults in code vs. install-time questions for `mock_user_*`**: chose static-in-code. Mock user values are dev defaults, not configuration. Embedding them as install-time prompts forces every production OAuth installer to answer questions about a mock user they will never use.

---

## Acceptance criteria

- `packages/template-engine/templates/shared-types/` exists with manifest, three output files (UserContext, mock-user, session-manager), exactly one question (`session_cookie_name`), and validates.
- `packages/template-engine/templates/supabase-auth/` exists with manifest, four output files (middleware.ts, src/lib/auth/get-current-user.ts, src/lib/auth/require-auth.ts, app/api/auth/me/route.ts), unconditional conflicts with all eight auth providers, and validates.
- `packages/template-engine/templates/supabase/` v3.0 has no auth deps, no auth outputs, no auth-related questions.
- `packages/template-engine/templates/auth-mock/` v3.0 emits only `middleware.ts` and `.env.auth.example`; uses one `auto`-typed question derived from `shared-types.session_cookie_name`.
- `hexagen add supabase` (alone, with `features = ["database","storage"]`) emits **zero** files from `shared-types`, `auth-mock`, or any auth path. Asserted by the new storage-only emit test.
- `hexagen add supabase-auth` auto-resolves `supabase`, `shared-types`, and `auth-mock`; emits the full storage + auth stack; middleware imports `MOCK_USER` and `COOKIE_NAME` from shared-types-owned paths.
- All five Group A providers install correctly; their `get-current-user.ts` imports `COOKIE_NAME` from session-manager (single source of truth).
- `hexagen templates info auth-mock` shows `session_cookie_name [auto: derived from shared-types.session_cookie_name]`.
- Wizard's per-template questions step does not render `auto`-typed questions; Summary step annotates them with their source.
- Conflict matrix symmetric across (Group A ∪ Group B ∪ {supabase-auth}); the new conflict-symmetry test passes.
- Test counts: ≥ current 48 template-engine + at least 4 new (auto-resolution, supabase-only emit, supabase-auth full-stack emit, conflict-symmetry).
- `apps/web` typechecks; `arch-lint` clean; planning docs 03/04/05 updated; new doc 15 (Supabase Auth) added; JOB-INDEX updated to 16 templates.

---

## Estimated scope

| Area                                                                                 | LOC ±             |
| ------------------------------------------------------------------------------------ | ----------------- |
| New `shared-types` template (manifest + 3 files + tests)                             | +260              |
| New `supabase-auth` template (manifest + 4 moved files + tests)                      | +200              |
| Trim auth-mock to v3.0 (manifest + drop moved outputs)                               | -220              |
| Trim supabase to v3.0 (drop auth feature, outputs, conflicts)                        | -200              |
| Group A provider updates (5 manifests + 5 `get-current-user.ts` imports + conflicts) | -25 / +40         |
| Group B provider updates (3 manifests gain supabase-auth conflict)                   | +15               |
| Wizard auto-question filter + Summary annotation + catalog entry                     | +90               |
| Tests (auto-resolution + storage-only emit + full-stack emit + conflict-symmetry)    | +320              |
| Docs (this plan + 03 + 04 + 05 + new 15 + JOB-INDEX + memory)                        | +380              |
| **Total**                                                                            | **~+1305 / -445** |

Net: ~+860 LOC, single bulk PR, ~1.5-day effort. Larger than v2 because the supabase-auth template materializes as its own first-class entity (with manifest, planning doc, catalog entry, and dedicated tests) rather than living gated inside the supabase manifest.
