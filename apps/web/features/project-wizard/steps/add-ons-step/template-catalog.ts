export interface TemplateDetails {
  overview: string;
  includes: string[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  requires: string[];
  conflicts: string[];
  category: "foundation" | "infrastructure" | "ai" | "auth" | "tooling";
  details: TemplateDetails;
}

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
      "AUTH_MODE=mock|real toggle, UserContext value object, session cookie, and real-provider stub",
    requires: ["env-setup"],
    conflicts: [],
    category: "auth",
    details: {
      overview:
        "Foundation for all auth integrations. Provides an AUTH_MODE toggle so you can develop features against a mock user before wiring up a real provider.",
      includes: [
        "AUTH_MODE=mock|real env var",
        "Typed UserContext value object (id, email, roles)",
        "Session cookie read/write helpers",
        "Real-provider stub to fill in when integrating a provider",
      ],
    },
  },
  {
    id: "google-oauth",
    name: "Google OAuth",
    description:
      "Server-side OAuth 2.0 callback route, ID token verification via googleapis, session hydration, typed GoogleUser value object",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
    details: {
      overview:
        "Server-side Google OAuth 2.0 integration using googleapis. Handles the full callback flow and hydrates a typed GoogleUser into the session via the auth-mock UserContext pattern.",
      includes: [
        "OAuth 2.0 callback route with CSRF state validation",
        "ID token verification via google-auth-library",
        "Typed GoogleUser value object with profile fields",
        "Session hydration using the auth-mock UserContext pattern",
      ],
    },
  },
  {
    id: "github-oauth",
    name: "GitHub OAuth",
    description:
      "GitHub OAuth app flow, access token exchange, user profile fetch, typed GitHubUser value object",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
    details: {
      overview:
        "Lightweight GitHub OAuth App integration. Exchanges the authorization code for an access token, fetches the user profile and primary email, and writes a typed GitHubUser into the session.",
      includes: [
        "Authorization redirect and callback route handlers",
        "Access token exchange via GitHub OAuth API",
        "User profile + primary email fetch",
        "Typed GitHubUser value object",
      ],
    },
  },
  {
    id: "microsoft-entra",
    name: "Microsoft Entra",
    description:
      "MSAL confidential-client flow, token cache, group-claim role mapping, typed EntraUser value object",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
    details: {
      overview:
        "Microsoft Entra ID (Azure AD) integration using MSAL. Supports confidential-client auth code flow with token caching, and maps AAD group claims to application roles.",
      includes: [
        "MSAL ConfidentialClientApplication setup",
        "Auth code flow with PKCE: redirect and callback routes",
        "In-memory token cache with silent refresh",
        "Group claim to application role mapping",
        "Typed EntraUser value object",
      ],
    },
  },
  {
    id: "magic-link",
    name: "Magic Link",
    description:
      "Passwordless email flow, signed token generation, Resend/Nodemailer transport, expiry and replay protection",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
    details: {
      overview:
        "Passwordless email authentication using short-lived signed tokens. Supports both Resend and Nodemailer as the email transport with a clean abstraction.",
      includes: [
        "Token generation with HMAC-SHA256 signing and TTL",
        "Email delivery via Resend (default) or Nodemailer",
        "Callback route with replay-protection (single-use tokens)",
        "Session creation after successful verification",
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
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "clerk",
      "better-auth",
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
  },
  {
    id: "clerk",
    name: "Clerk",
    description:
      "Clerk SDK, middleware, useUser/useAuth hooks, JWT template for API routes, org-aware role guards",
    requires: ["env-setup"],
    conflicts: [
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "nextauth",
      "better-auth",
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
  },
  {
    id: "better-auth",
    name: "Better Auth",
    description:
      "Better Auth server setup, social providers, magic-link plugin, schema migration, typed session client",
    requires: ["env-setup"],
    conflicts: [
      "google-oauth",
      "github-oauth",
      "microsoft-entra",
      "magic-link",
      "adobe-ims-spa",
      "nextauth",
      "clerk",
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
  },
  {
    id: "adobe-ims-spa",
    name: "Adobe IMS SPA (PKCE)",
    description:
      "Modern Adobe IMS Single Page App + PKCE flow: login, callback, logout routes, token store, auto-refresh",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
    details: {
      overview:
        "Modern Adobe IMS Single Page App authentication using PKCE. Handles the full login, callback, and silent refresh lifecycle for Adobe Experience Cloud integrations.",
      includes: [
        "PKCE-based IMS OAuth 2.0 login and callback routes",
        "Access and refresh token storage with encryption at rest",
        "Silent token refresh with configurable pre-expiry window",
        "Auto-logout on token expiry with redirect",
        "Typed AdobeUser value object with IMS profile fields",
      ],
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "SSR-safe client setup, storage helpers, auth helpers (getUser not getSession), RLS examples, type generation",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
    details: {
      overview:
        "SSR-safe Supabase client setup with auth helpers following Supabase's current best practices. Includes Row Level Security policy examples and a type-generation script.",
      includes: [
        "SSR-safe createServerClient and createBrowserClient setup",
        "Auth helpers using getUser() (not deprecated getSession())",
        "RLS policy examples for common patterns",
        "Type generation script (supabase gen types typescript)",
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
