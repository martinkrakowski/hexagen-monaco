# Clerk (`clerk`)

> Standalone Clerk integration: `clerkMiddleware` route protection, server-side auth helpers, an
> org/app-level `RoleGuard` component, a protected route group, and a JWT-template API example.

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **ID**        | `clerk`                                                    |
| **Category**  | Auth framework (group B)                                   |
| **Requires**  | `env-setup`                                                |
| **Conflicts** | every other auth provider/framework (one strategy per app) |
| **Branch**    | `feature/generator-template-clerk`                         |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Wires Clerk's hosted auth into the app: middleware route protection, server helpers, a
`RoleGuard` (org-role or app-role), a `(protected)` route group, and an example API route that
verifies a Clerk JWT template. Clerk hosts the sign-in/up UI.

## Service & API

- **Provider:** Clerk (hosted). `clerkMiddleware` protects `protected_paths`.
- **Roles:** org features gate on `orgRole`; app roles via `sessionClaims.metadata.role`.
- **API auth:** a named JWT template for downstream tokens.

## Install

`hexagen add clerk`. Questions: `protected_paths`, `org_features` (bool), `jwt_template` (name).

Env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the `NEXT_PUBLIC_CLERK_*`
sign-in/up/after URLs. Emits `middleware.ts`, `src/lib/auth.ts`, `src/lib/role-guard.tsx`,
`app/(protected)/layout.tsx`, `app/api/protected-example/route.ts`, `.env.clerk.example`.

## Usage

```tsx
import { RoleGuard } from "@/lib/role-guard";

<RoleGuard role="admin">{/* admin-only UI */}</RoleGuard>;
```

## Notes for agents

- `npm install @clerk/nextjs`; wrap the root layout in `<ClerkProvider>`.
- Set publishable + secret keys; add `<SignIn />`/`<SignUp />` pages at the configured URLs.
- Org features require enabling Organizations in the dashboard; create the JWT template if the API
  example mints tokens.
- Standalone — conflicts with every other auth template.

## Checklist (post-install)

Install `@clerk/nextjs`; add `<ClerkProvider>`; set keys; add sign-in/up pages; enable org/role
features if used; create the JWT template; test a protected path while signed out.

## Related

Requires [`env-setup`](../env-setup). Alternatives: [`nextauth`](../nextauth), [`better-auth`](../better-auth).
