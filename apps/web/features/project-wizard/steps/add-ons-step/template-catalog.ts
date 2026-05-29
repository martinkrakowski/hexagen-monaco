export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  requires: string[];
  conflicts: string[];
  category: "foundation" | "infrastructure" | "ai" | "auth" | "tooling";
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
  },
  {
    id: "agents-md",
    name: "AGENTS.md",
    description:
      "Rich AGENTS.md with mode system, tech stack reference, commands-after-edits table, and companion .agents/ spec directory",
    requires: [],
    conflicts: [],
    category: "foundation",
  },
  {
    id: "error-handling",
    name: "Error Handling",
    description:
      "3-layer error hierarchy, Result<T,E> type, RFC 7807 HTTP mapping, React error boundary",
    requires: ["env-setup"],
    conflicts: [],
    category: "foundation",
  },
  {
    id: "observability",
    name: "Observability",
    description:
      "Structured JSON logging, correlation IDs via AsyncLocalStorage, request logger middleware, /api/health endpoint",
    requires: [],
    conflicts: [],
    category: "infrastructure",
  },
  {
    id: "rate-limiting",
    name: "Rate Limiting",
    description:
      "Differentiated middleware (text/image/general), session+IP hybrid identification, configurable limits, debug logging",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
  },
  {
    id: "docker",
    name: "Docker",
    description:
      "Multi-stage Dockerfile, docker-compose with peer services, dev override for hot reload, GitHub Actions image push",
    requires: [],
    conflicts: [],
    category: "infrastructure",
  },
  {
    id: "ci-github-actions",
    name: "CI / GitHub Actions",
    description:
      "Build+typecheck+lint+test CI, Vercel/Railway/Fly/VPS deploy workflow, PR preview deploys, Dependabot",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
  },
  {
    id: "llm-adapter",
    name: "LLM Adapter",
    description:
      "Typed port interface, provider adapters (xAI), model constants, reasoning routing, retry logic, structured output",
    requires: ["env-setup"],
    conflicts: [],
    category: "ai",
  },
  {
    id: "langgraph",
    name: "LangGraph",
    description:
      "AgentGraphPort interface, typed state, node stubs, graph compilation, checkpointing, optional streaming and human-in-the-loop",
    requires: ["llm-adapter", "env-setup"],
    conflicts: [],
    category: "ai",
  },
  {
    id: "bullmq",
    name: "BullMQ",
    description:
      "Typed job queues, workers, Redis fallback to in-process sync execution, optional Bull Board dashboard",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
  },
  {
    id: "auth-mock",
    name: "Auth Mock",
    description:
      "AUTH_MODE=mock|real toggle, UserContext value object, session cookie, and real-provider stub",
    requires: ["env-setup"],
    conflicts: [],
    category: "auth",
  },
  {
    id: "google-oauth",
    name: "Google OAuth",
    description:
      "Server-side OAuth 2.0 callback route, ID token verification via googleapis, session hydration, typed GoogleUser value object",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
  },
  {
    id: "github-oauth",
    name: "GitHub OAuth",
    description:
      "GitHub OAuth app flow, access token exchange, user profile fetch, typed GitHubUser value object",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
  },
  {
    id: "microsoft-entra",
    name: "Microsoft Entra",
    description:
      "MSAL confidential-client flow, token cache, group-claim role mapping, typed EntraUser value object",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
  },
  {
    id: "magic-link",
    name: "Magic Link",
    description:
      "Passwordless email flow, signed token generation, Resend/Nodemailer transport, expiry and replay protection",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
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
  },
  {
    id: "adobe-ims-spa",
    name: "Adobe IMS SPA (PKCE)",
    description:
      "Modern Adobe IMS Single Page App + PKCE flow: login, callback, logout routes, token store, auto-refresh",
    requires: ["auth-mock", "env-setup"],
    conflicts: ["nextauth", "clerk", "better-auth"],
    category: "auth",
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "SSR-safe client setup, storage helpers, auth helpers (getUser not getSession), RLS examples, type generation",
    requires: ["env-setup"],
    conflicts: [],
    category: "infrastructure",
  },
  {
    id: "design-system",
    name: "Design System",
    description:
      "Populated DESIGN.md contract, CSS custom property tokens, Tailwind config extension, base component stubs",
    requires: [],
    conflicts: [],
    category: "tooling",
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
