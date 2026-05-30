export interface TemplateDetails {
  overview: string;
  includes: string[];
}

export interface CatalogNote {
  /** Short label shown as a badge on the tile */
  badge: string;
  /** Full explanation shown in the information modal */
  detail: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  requires: string[];
  conflicts: string[];
  category: "foundation" | "infrastructure" | "ai" | "auth" | "tooling";
  details: TemplateDetails;
  note?: CatalogNote;
  /**
   * IDs of templates that are commonly used together with this one. The
   * add-ons step surfaces them as one-click "Add X" suggestions in a banner
   * when this template is selected but the companion is not. Discoverability
   * only — does not affect dependency resolution or conflict detection.
   */
  companions?: string[];
}

const STANDALONE_NOTE: CatalogNote = {
  badge: "Standalone",
  detail:
    "Standalone framework — replaces the auth layer entirely. Conflicts with all Group A providers and the other Group B frameworks.",
};

export const TEMPLATE_CATALOG: CatalogEntry[] = [
  {
    id: "env-setup",
    name: "Env Setup",
    description:
      "Categorised .env.example, Zod runtime validation, check-env script, and SETUP.md first-day guide",
    requires: [],
    conflicts: [],
    category: "foundation",
    details: {
      overview:
        "Establishes a disciplined environment variable pattern across your project. All variables are declared in a categorised .env.example, validated at startup with Zod schemas, and checked before the server can start.",
      includes: [
        ".env.example with grouped sections (server, client, third-party)",
        "Zod schema with process.env validation and typed exports",
        "check-env Node script that fails fast on missing vars",
        "SETUP.md first-day guide covering required vars, local dev setup, and caveats",
      ],
    },
  },
  {
    id: "agents-md",
    name: "AGENTS.md",
    description:
      "Rich AGENTS.md with mode system, tech stack reference, commands-after-edits table, and companion .agents/ spec directory",
    requires: [],
    conflicts: [],
    category: "foundation",
    details: {
      overview:
        "Enriches AI-assisted development with a comprehensive AGENTS.md that defines coding conventions, architecture constraints, and a commands-after-edits table so agents know what to run after changing files.",
      includes: [
        "Top-level AGENTS.md with mode system and tech stack reference",
        "commands-after-edits table mapping file patterns to check commands",
        ".agents/ spec directory with per-feature AI prompts",
        "Companion snippets for common agent workflows",
      ],
    },
  },
  {
    id: "error-handling",
    name: "Error Handling",
    description:
      "3-layer error hierarchy, Result<T,E> type, RFC 7807 HTTP mapping, React error boundary",
    requires: ["env-setup"],
    conflicts: [],
    category: "foundation",
    details: {
      overview:
        "Provides a layered error taxonomy so every failure has a well-typed origin and maps cleanly to an HTTP status. Eliminates catch (e: any) and ad-hoc status code logic across route handlers.",
      includes: [
        "Domain, Application, and Infrastructure error base classes",
        "Result<T, E> type for explicit error propagation without exceptions",
        "RFC 7807 Problem Details HTTP mapper",
        "React error boundary with formatted fallback UI",
      ],
    },
  },
  {
    id: "observability",
    name: "Observability",
    description:
      "Structured JSON logging, correlation IDs via AsyncLocalStorage, request logger middleware, /api/health endpoint",
    requires: [],
    conflicts: [],
    category: "infrastructure",
    details: {
      overview:
        "Adds production-grade structured logging and request tracing without external dependencies. Every log line carries a correlation ID that spans the full request lifecycle.",
      includes: [
        "Structured JSON logger (pino-compatible shape)",
        "AsyncLocalStorage correlation ID propagation",
        "Request/response middleware with latency and status logging",
        "/api/health endpoint returning process uptime and version",
      ],
    },
  },
  {
    id: "rate-limiting",
    name: "Rate Limiting",
    description:
      "Differentiated middleware (text/image/general), session+IP hybrid identification, configurable limits, debug logging",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
    details: {
      overview:
        "Sliding-window rate limiter with differentiated buckets for text, image, and general API routes. Identifies clients by session cookie with IP fallback, and supports trust-proxy mode for deployments behind a load balancer.",
      includes: [
        "Differentiated middleware with configurable limits per bucket",
        "Session + IP hybrid client identification",
        "RATE_LIMIT_TRUST_PROXY env var for X-Forwarded-For opt-in",
        "Debug logging mode and .env.rate-limit.example",
      ],
    },
  },
  {
    id: "docker",
    name: "Docker",
    description:
      "Multi-stage Dockerfile, docker-compose with peer services, dev override for hot reload, GitHub Actions image push",
    requires: [],
    conflicts: [],
    category: "infrastructure",
    details: {
      overview:
        "Multi-stage Dockerfile optimised for size and layer caching, with a docker-compose setup for running the app alongside peer services in local development.",
      includes: [
        "Multi-stage Dockerfile (deps → builder → runner)",
        "docker-compose.yml with database and cache services",
        "docker-compose.override.yml for hot-reload dev mode",
        "GitHub Actions workflow for building and pushing the image",
      ],
    },
  },
  {
    id: "ci-github-actions",
    name: "CI / GitHub Actions",
    description:
      "Build+typecheck+lint+test CI, Vercel/Railway/Fly/VPS deploy workflow, PR preview deploys, Dependabot",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
    details: {
      overview:
        "Ready-to-use CI/CD pipeline covering build, typecheck, lint, and test on every push, plus deployment workflows for the four most common hosting platforms.",
      includes: [
        "CI workflow: build, typecheck, lint, test with matrix caching",
        "Deploy workflow variants for Vercel, Railway, Fly.io, and VPS SSH",
        "PR preview deploy with sticky comment posting the preview URL",
        "Dependabot config for automated dependency updates",
      ],
    },
  },
  {
    id: "llm-adapter",
    name: "LLM Adapter",
    description:
      "Typed port interface, provider adapters (xAI), model constants, reasoning routing, retry logic, structured output",
    requires: ["env-setup"],
    conflicts: [],
    category: "ai",
    details: {
      overview:
        "Defines a clean port interface for LLM calls so the rest of your application stays provider-agnostic. Ships with an xAI adapter, model constants, reasoning-mode routing, and retry logic.",
      includes: [
        "Typed LLMPort interface with complete() and stream() methods",
        "xAI (Grok) adapter with model constants",
        "Reasoning vs standard routing based on task complexity",
        "Exponential backoff retry with jitter",
        "Structured output helpers",
      ],
    },
  },
  {
    id: "langgraph",
    name: "LangGraph",
    description:
      "AgentGraphPort interface, typed state, node stubs, graph compilation, checkpointing, optional streaming and human-in-the-loop",
    requires: ["llm-adapter", "env-setup"],
    conflicts: [],
    category: "ai",
    details: {
      overview:
        "Scaffolds a LangGraph agent with typed state, node stubs, and graph compilation wired to your LLM adapter. Includes optional checkpointing, streaming, and human-in-the-loop pause/resume.",
      includes: [
        "Typed AgentState and AgentGraphPort interface",
        "Pre-wired graph with planner, executor, and reviewer node stubs",
        "Graph compilation and invoke / stream entrypoints",
        "MemorySaver checkpointing for conversation persistence",
        "Optional human-in-the-loop interrupt_before pause/resume",
      ],
    },
  },
  {
    id: "bullmq",
    name: "BullMQ",
    description:
      "Typed job queues, workers, Redis fallback to in-process sync execution, optional Bull Board dashboard",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
    details: {
      overview:
        "Typed job queue infrastructure backed by Redis. Falls back to synchronous in-process execution when Redis is unavailable, making it safe for local dev without a running Redis instance.",
      includes: [
        "Typed queue and worker factory with DI-friendly ports",
        "Redis connection with health check and graceful shutdown",
        "In-process sync fallback for local dev (no Redis required)",
        "Optional Bull Board dashboard at /admin/queues",
      ],
    },
  },
  {
    id: "auth-mock",
    name: "Auth Mock",
    description:
      "UserContext value object, MOCK_USER constant, generic session-cookie helpers, and a dev-only root middleware that injects MOCK_USER when AUTH_MODE=mock",
    requires: ["env-setup"],
    conflicts: [],
    category: "auth",
    details: {
      overview:
        "Foundation layer for all auth integrations. Ships the UserContext domain type, a configurable MOCK_USER, generic AES-256-GCM session-cookie helpers, and a dev-only root middleware that injects MOCK_USER as x-user-context when AUTH_MODE=mock. Real providers (google-oauth, supabase, etc.) ship their own middleware that overwrites this dev one and still honours AUTH_MODE=mock as a short-circuit.",
      includes: [
        "UserContext value object (id, email, name, roles, avatarUrl) — domain-owned",
        "MOCK_USER constant (overridable at runtime via MOCK_USER_* env vars)",
        "Generic session-cookie read/write/clear helpers used by real providers",
        "Dev-only root middleware: AUTH_MODE=mock → inject MOCK_USER; otherwise pass through",
      ],
    },
  },
  {
    id: "google-oauth",
    name: "Google OAuth",
    description:
      "Server-side OAuth 2.0 (login → callback → AES-256-GCM session), optional hosted-domain restriction, root middleware that protects configured paths",
    requires: ["shared-types", "auth-mock", "env-setup"],
    conflicts: [
      "nextauth",
      "clerk",
      "better-auth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Server-side Google OAuth 2.0 integration. Owns the full auth stack end-to-end: login/callback/logout routes, encrypted session cookie, /api/auth/me, getCurrentUser/requireAuth helpers, and a root middleware that protects configured paths while honouring AUTH_MODE=mock as a dev short-circuit.",
      includes: [
        "OAuth 2.0 login + callback + logout routes with CSRF state validation",
        "Typed GoogleUser + AES-256-GCM stateless session cookie",
        "Optional hosted-domain (Google Workspace) restriction",
        "Root middleware.ts protecting configured path prefixes",
        "/api/auth/me + getCurrentUser()/requireAuth() helpers in src/lib/auth/",
      ],
    },
  },
  {
    id: "github-oauth",
    name: "GitHub OAuth",
    description:
      "GitHub OAuth App flow with primary-email fetch, optional org-membership gate, AES-256-GCM session, and a root middleware that protects configured paths",
    requires: ["shared-types", "auth-mock", "env-setup"],
    conflicts: [
      "nextauth",
      "clerk",
      "better-auth",
      "google-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Lightweight GitHub OAuth App integration. Owns the full auth stack: login/callback/logout routes, encrypted session cookie, /api/auth/me, getCurrentUser/requireAuth helpers, and a root middleware that protects configured paths while honouring AUTH_MODE=mock as a dev short-circuit.",
      includes: [
        "Authorization redirect, callback, and logout route handlers",
        "Access token exchange + primary-email fetch",
        "Optional org-membership gate (read:org scope)",
        "Typed GitHubUser + AES-256-GCM stateless session cookie",
        "Root middleware.ts protecting configured path prefixes",
        "/api/auth/me + getCurrentUser()/requireAuth() helpers in src/lib/auth/",
      ],
    },
  },
  {
    id: "microsoft-entra",
    name: "Microsoft Entra",
    description:
      "Entra ID confidential-client PKCE flow, Microsoft Graph profile + group fetch, AAD group-to-role mapping, AES-256-GCM session, root middleware",
    requires: ["shared-types", "auth-mock", "env-setup"],
    conflicts: [
      "nextauth",
      "clerk",
      "better-auth",
      "google-oauth",
      "github-oauth",
      "magic-link",
      "adobe-ims-spa",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Microsoft Entra ID (Azure AD) integration. Owns the full auth stack: confidential-client PKCE login/callback/logout routes, encrypted session cookie, /api/auth/me, getCurrentUser/requireAuth helpers, and a root middleware that protects configured paths while honouring AUTH_MODE=mock as a dev short-circuit.",
      includes: [
        "Auth code flow with PKCE: login + callback + logout routes",
        "Microsoft Graph profile + group fetch",
        "AAD group object ID to application role mapping",
        "Typed EntraUser + AES-256-GCM stateless session cookie",
        "Root middleware.ts protecting configured path prefixes",
        "/api/auth/me + getCurrentUser()/requireAuth() helpers in src/lib/auth/",
      ],
    },
  },
  {
    id: "magic-link",
    name: "Magic Link",
    description:
      "Passwordless email flow, HMAC-SHA256 single-use tokens, Resend/Nodemailer transport, replay protection, AES-256-GCM session, root middleware",
    requires: ["shared-types", "auth-mock", "env-setup"],
    conflicts: [
      "nextauth",
      "clerk",
      "better-auth",
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "adobe-ims-spa",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Passwordless email authentication using short-lived signed tokens. Owns the full auth stack: request/verify/logout routes, encrypted session cookie, /api/auth/me, getCurrentUser/requireAuth helpers, and a root middleware that protects configured paths while honouring AUTH_MODE=mock as a dev short-circuit.",
      includes: [
        "HMAC-SHA256 signed single-use tokens with configurable TTL",
        "Resend (default) or Nodemailer email transport",
        "10k-entry LRU replay store for single-use enforcement",
        "AES-256-GCM stateless session cookie",
        "Root middleware.ts protecting configured path prefixes",
        "/api/auth/me + getCurrentUser()/requireAuth() helpers in src/lib/auth/",
      ],
    },
  },
  {
    id: "nextauth",
    name: "Auth.js (NextAuth v5)",
    description:
      "Auth.js v5 with Google, GitHub and Credentials providers, JWT session strategy, middleware route protection",
    requires: ["env-setup"],
    conflicts: [
      "auth-mock",
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "clerk",
      "better-auth",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Auth.js v5 (NextAuth) wired with Google, GitHub, and Credentials providers out of the box. Uses JWT session strategy and a middleware file that protects routes based on matcher patterns.",
      includes: [
        "Auth.js v5 auth.ts config with multiple providers",
        "Google and GitHub OAuth provider setup",
        "Credentials provider with bcrypt password check stub",
        "JWT session strategy with typed session.user",
        "Middleware file with configurable route matcher",
      ],
    },
    note: STANDALONE_NOTE,
  },
  {
    id: "clerk",
    name: "Clerk",
    description:
      "Clerk SDK, middleware, useUser/useAuth hooks, JWT template for API routes, org-aware role guards",
    requires: ["env-setup"],
    conflicts: [
      "auth-mock",
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "nextauth",
      "better-auth",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Full Clerk integration with server and client-side SDK wiring. Includes a JWT template for adding Clerk session tokens to API requests and organisation-aware role guards.",
      includes: [
        "middleware.ts with clerkMiddleware and route matcher",
        "useUser and useAuth hook usage examples",
        "JWT template config for authenticating API routes",
        "Organisation and role guard wrapper components",
      ],
    },
    note: STANDALONE_NOTE,
  },
  {
    id: "better-auth",
    name: "Better Auth",
    description:
      "Better Auth server setup, social providers, magic-link plugin, schema migration, typed session client",
    requires: ["env-setup"],
    conflicts: [
      "auth-mock",
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "nextauth",
      "clerk",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Better Auth server setup with social providers, the magic-link plugin, and database schema migration helpers. Exports a typed session client for use in React components.",
      includes: [
        "Better Auth server config with email/password and social providers",
        "Magic-link plugin integration",
        "Database schema generation and migration script",
        "Typed authClient for browser/server use",
      ],
    },
    note: STANDALONE_NOTE,
  },
  {
    id: "adobe-ims-spa",
    name: "Adobe IMS SPA (PKCE)",
    description:
      "Adobe IMS PKCE flow with encrypted token store, auto-refresh, and a root middleware that validates IMS sessions on configured paths",
    requires: ["shared-types", "auth-mock", "env-setup"],
    conflicts: [
      "nextauth",
      "clerk",
      "better-auth",
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "supabase-auth",
    ],
    category: "auth",
    details: {
      overview:
        "Modern Adobe IMS Single Page App authentication using PKCE. Owns the full auth stack: login/callback/logout routes, encrypted IMS tokens cookie, auto-refresh, /api/auth/me, getCurrentUser/requireAuth helpers, and a root middleware that validates the IMS session on protected paths while honouring AUTH_MODE=mock as a dev short-circuit.",
      includes: [
        "PKCE-based IMS OAuth 2.0 login + callback + logout routes",
        "Access + refresh token storage encrypted at rest (AES-256-GCM)",
        "Silent token refresh with configurable pre-expiry window",
        "Typed AdobeUser/IMSUserProfile + Adobe IMS profile fetch in middleware",
        "Root middleware.ts protecting configured path prefixes",
        "/api/auth/me + getCurrentUser()/requireAuth() helpers in src/lib/auth/",
      ],
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "SSR-safe clients, storage helpers, RLS examples, type generation, optional Drizzle ORM. Pure storage/database layer — add the Supabase Auth template to layer @supabase/ssr-based session middleware on top.",
    requires: ["env-setup"],
    conflicts: [],
    companions: ["supabase-auth"],
    category: "infrastructure",
    details: {
      overview:
        "SSR-safe Supabase client setup with storage, RLS, optional Drizzle ORM and realtime. No auth code — that's the separate Supabase Auth template, which requires this one. Coexists with any auth provider when used storage-only.",
      includes: [
        "SSR-safe createServerClient and createBrowserClient setup",
        "Storage helpers (upload, download, signed URLs, delete)",
        "RLS policy examples and type generation script (supabase gen types)",
        "Optional Drizzle ORM layer + realtime subscription example",
        "For Supabase-backed session auth, add the Supabase Auth template",
      ],
    },
  },
  {
    id: "supabase-auth",
    name: "Supabase Auth",
    description:
      "Auth provider built on the Supabase template: @supabase/ssr root middleware, getCurrentUser/requireAuth, and /api/auth/me — all honouring AUTH_MODE=mock as a dev short-circuit.",
    requires: ["supabase", "shared-types", "auth-mock", "env-setup"],
    conflicts: [
      "nextauth",
      "clerk",
      "better-auth",
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
    ],
    category: "auth",
    details: {
      overview:
        "Server-validated session auth on top of Supabase. Owns the full auth stack: @supabase/ssr root middleware that refreshes the session and protects configured paths, /api/auth/me, and getCurrentUser()/requireAuth() helpers in src/lib/auth/ — all honouring AUTH_MODE=mock as a dev short-circuit. Requires the Supabase template (auto-resolved).",
      includes: [
        "@supabase/ssr root middleware: session refresh + protected-path enforcement",
        "getCurrentUser uses server-validated getUser() — never the deprecated getSession()",
        "/api/auth/me for client-side bootstrap",
        "AUTH_MODE=mock dev short-circuit injects MOCK_USER from shared-types",
        "Mutually exclusive with Group A providers and Group B frameworks",
      ],
    },
  },
  {
    id: "design-system",
    name: "Design System",
    description:
      "Populated DESIGN.md contract, CSS custom property tokens, Tailwind config extension, base component stubs",
    requires: [],
    conflicts: [],
    category: "tooling",
    details: {
      overview:
        "Establishes a design system contract with CSS custom property tokens, a Tailwind config extension, and a populated DESIGN.md that documents colour, typography, and spacing decisions.",
      includes: [
        "Populated DESIGN.md with colour, type, and spacing contracts",
        "CSS custom property tokens (--color-*, --space-*, --radius-*)",
        "Tailwind config extension mapping tokens to utility classes",
        "Base component stubs (Button, Card, Badge) using the token system",
      ],
    },
  },
];

const CATALOG_BY_ID = new Map(TEMPLATE_CATALOG.map((e) => [e.id, e]));

/**
 * Returns the already-selected entries that conflict with `candidateId`.
 * The check is symmetric: a conflict declared on either side counts, since
 * catalog `conflicts` lists are not always reciprocal.
 */
export function findConflicts(
  candidateId: string,
  selectedIds: string[],
): CatalogEntry[] {
  const candidate = CATALOG_BY_ID.get(candidateId);
  if (!candidate) return [];
  return selectedIds
    .filter((id) => id !== candidateId)
    .map((id) => CATALOG_BY_ID.get(id))
    .filter((e): e is CatalogEntry => e !== undefined)
    .filter(
      (e) =>
        candidate.conflicts.includes(e.id) ||
        e.conflicts.includes(candidate.id),
    );
}

/**
 * Returns the catalog entries that are companions of any selected template
 * but are themselves not selected. Used by the discoverability banner in the
 * add-ons step. The result preserves declaration order: each selected
 * template's companions are returned in the order they appear in that
 * template's `companions` field, and selected templates are walked in
 * `selectedIds` order. Duplicates are de-deduplicated (a companion mentioned
 * by two selected templates appears once).
 */
export function findCompanionSuggestions(
  selectedIds: string[],
): CatalogEntry[] {
  const selectedSet = new Set(selectedIds);
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const id of selectedIds) {
    const entry = CATALOG_BY_ID.get(id);
    if (!entry?.companions) continue;
    for (const compId of entry.companions) {
      if (seen.has(compId)) continue;
      if (selectedSet.has(compId)) continue;
      const comp = CATALOG_BY_ID.get(compId);
      if (!comp) continue;
      seen.add(compId);
      out.push(comp);
    }
  }
  return out;
}

export const CATEGORY_LABELS: Record<CatalogEntry["category"], string> = {
  foundation: "Foundation",
  infrastructure: "Infrastructure",
  ai: "AI / LLM",
  auth: "Auth",
  tooling: "Tooling",
};

export const CATEGORIES = [
  "foundation",
  "infrastructure",
  "ai",
  "auth",
  "tooling",
] as const satisfies CatalogEntry["category"][];
