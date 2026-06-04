import {
  TEMPLATE_MANIFESTS,
  type TemplateManifestMeta,
} from "./template-manifest.generated";

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

export type CatalogCategory =
  | "foundation"
  | "infrastructure"
  | "ai"
  | "auth"
  | "adobe"
  | "tooling";

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  requires: string[];
  conflicts: string[];
  category: CatalogCategory;
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

/**
 * The hand-curated, UI-only half of a catalog entry. `name`, `description`,
 * `requires`, and `conflicts` are NOT here — they are generated from the
 * template manifests (template-manifest.generated.ts) and merged in below, so
 * they can never drift from the source of truth. Adding a template means adding
 * its presentation here; the parity test fails the build if a manifest has no
 * presentation entry (an unselectable template) or vice versa (a ghost card).
 */
interface CatalogPresentation {
  id: string;
  category: CatalogCategory;
  details: TemplateDetails;
  note?: CatalogNote;
  companions?: string[];
}

const STANDALONE_NOTE: CatalogNote = {
  badge: "Standalone",
  detail:
    "Standalone framework — replaces the auth layer entirely. Conflicts with all Group A providers and the other Group B frameworks.",
};

const PRESENTATION: CatalogPresentation[] = [
  {
    id: "env-setup",
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
    category: "foundation",
    details: {
      overview:
        "Enriches AI-assisted development with a comprehensive AGENTS.md that defines coding conventions, architecture constraints, and a commands-after-edits table so agents know what to run after changing files.",
      includes: [
        "Top-level AGENTS.md with mode system and tech stack reference",
        "commands-after-edits table mapping file patterns to check commands",
        "A Conventions section directing agents to the structured logger (never console.log)",
        ".agents/ spec directory with per-feature AI prompts",
      ],
    },
  },
  {
    id: "error-handling",
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
    category: "infrastructure",
    companions: ["eslint-no-console"],
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
    category: "ai",
    details: {
      overview:
        "Defines a clean port interface for LLM calls so the rest of your application stays provider-agnostic. Ships adapters for xAI, OpenAI, Anthropic, Ollama, and Azure OpenAI, with model constants, reasoning-mode routing, and retry logic.",
      includes: [
        "Typed LLMClientPort with provider adapters and a router",
        "xAI / OpenAI / Anthropic / Ollama / Azure OpenAI adapters",
        "Reasoning vs fast vs vision model routing",
        "Exponential backoff retry, timeout, and structured (Zod) output",
        "Provider-registration seam (extend it with llm-adapter-bedrock)",
      ],
    },
  },
  {
    id: "llm-adapter-bedrock",
    category: "ai",
    details: {
      overview:
        "Adds Amazon Bedrock (Converse API) as a provider to the llm-adapter router via its provider-registration seam — no base files overwritten. Auth uses the AWS credential chain.",
      includes: [
        "Bedrock adapter registered via a side-effect import",
        "Converse API; models addressed by inference-profile id",
        "AWS credential chain (task role / AWS_*); optional Guardrails",
      ],
    },
  },
  {
    id: "langgraph",
    category: "ai",
    details: {
      overview:
        "Scaffolds a LangGraph agent with typed state, node stubs, and graph compilation wired to your LLM adapter. Includes optional checkpointing, streaming, and human-in-the-loop pause/resume.",
      includes: [
        "Typed AgentState and AgentGraphPort interface",
        "A working example graph (simple-chain or research-agent) + node files",
        "Swap-by-env checkpointers (memory/supabase/redis/postgres)",
        "Next.js invoke route + optional streaming and human-in-the-loop resume",
      ],
    },
  },
  {
    id: "bedrock-agentcore-runtime",
    category: "ai",
    details: {
      overview:
        "Deploy the Hexagen TypeScript server to Amazon Bedrock AgentCore Runtime as an ARM64 container implementing the HTTP contract (POST /invocations, GET /ping). No Python agent scaffolding.",
      includes: [
        "/invocations + /ping handlers and an ARM64 Dockerfile.agentcore",
        "agentcore.json, an IAM execution policy, optional deploy workflow",
        "IAM or fail-closed OAuth inbound auth; implement AgentRuntimePort",
      ],
    },
  },
  {
    id: "bedrock-agentcore-services",
    category: "ai",
    details: {
      overview:
        "Hexagonal ports + adapters for Amazon Bedrock AgentCore stateful services — Memory, Gateway (APIs/Lambdas/MCP as tools), and Identity (workload token + IdP claim bridge to UserContext).",
      includes: [
        "AgentMemoryPort / ToolGatewayPort / AgentIdentityPort (gated by selection)",
        "Adapters over @aws-sdk/client-bedrock-agentcore",
        "Long-term memory strategies, MCP tool mapping, IdP→UserContext bridge",
      ],
    },
  },
  {
    id: "mcp-server",
    category: "ai",
    details: {
      overview:
        "Exposes your application's use-cases as MCP tools over stdio, so any MCP client (Claude Desktop/Code, IDE agents, an AgentCore Gateway, a LangGraph tool node) can call them. A tool is an inbound adapter over a use-case you already have — no business logic moves into it.",
      includes: [
        "McpServer composition root with a registerTransport(factory) seam",
        "Static tool registry + a worked example tool (input validation, explicit Result→MCP mapping, dry_run)",
        "Dynamic SDK import (ADR-0010) and @hexagen-server-only isolation (ADR-0037)",
        "stdio transport (secure local default); opt-in resources/prompts; node:test scaffolds under --with-tests",
      ],
    },
    companions: ["error-handling", "observability"],
  },
  {
    id: "mcp-server-http",
    category: "ai",
    details: {
      overview:
        "Adds a network-exposed Streamable-HTTP transport to the mcp-server base, always authenticated (bearer token or OAuth resource-server). A transport-factory addon — it plugs into the base's registerTransport seam without rewriting server.ts.",
      includes: [
        "Streamable-HTTP transport (SDK StreamableHTTPServerTransport, dynamically imported) on a Node http listener",
        "Per-request auth: bearer (constant-time token check) or OAuth (JWKS-verification scaffold), chosen at install",
        "Defense-in-depth startup guard: refuses streamable-http without an auth mode",
        "node:test scaffolds (guard + auth) under --with-tests",
      ],
    },
    companions: ["docker", "observability"],
  },
  {
    id: "bullmq",
    category: "infrastructure",
    details: {
      overview:
        "Background job processing on top of BullMQ. One worker per configured queue dispatches by job name to typed handlers; the queue layer transparently falls back to inline execution when Redis is unavailable, so local dev works without a running Redis instance. Ships with optional Bull Board (Basic-Auth-gated in production) and a recurring-job scheduler that re-registers definitions idempotently every startup so cron changes can't strand stale schedules in Redis.",
      includes: [
        "Typed addJob(queue, jobName, data) with per-queue / per-job-name routing",
        "Single Redis connection factory with auto / always / never fallback modes",
        "In-process sync fallback executor for local dev (no Redis required)",
        "Configurable per-queue worker concurrency",
        "Five opt-in example job handlers: image-processing, email, webhook, export, ai-generation",
        "Recurring-job scheduler with stale-cron pruning",
        "Optional Bull Board dashboard at /admin/queues with Basic Auth in production",
        "Same-process bootstrap (server/startup) and separate-service entrypoint (scripts/start-worker.ts)",
      ],
    },
  },
  {
    id: "auth-mock",
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
    id: "shared-types",
    category: "auth",
    details: {
      overview:
        "The auth-ecosystem foundation: the UserContext domain type, a runtime-overridable MOCK_USER, and generic AES-256-GCM session-cookie helpers (including the canonical COOKIE_NAME). Carries no opinion about mock vs. real auth.",
      includes: [
        "UserContext value object every auth provider speaks",
        "MOCK_USER with MOCK_USER_* runtime overrides",
        "AES-256-GCM session-cookie helpers + COOKIE_NAME resolver",
      ],
    },
  },
  {
    id: "google-oauth",
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
    category: "auth",
    note: STANDALONE_NOTE,
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
    category: "auth",
    note: STANDALONE_NOTE,
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
    category: "auth",
    note: STANDALONE_NOTE,
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
    category: "auth",
    details: {
      overview:
        "Modern Adobe IMS Single Page App authentication using PKCE — end-user auth, distinct from the Server-to-Server IMS in adobe-firefly-core. Owns the full auth stack: login/callback/logout routes, encrypted IMS tokens cookie, auto-refresh, /api/auth/me, getCurrentUser/requireAuth helpers, and a root middleware that validates the IMS session on protected paths while honouring AUTH_MODE=mock as a dev short-circuit.",
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
    category: "infrastructure",
    companions: ["supabase-auth"],
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
  {
    id: "eslint-no-console",
    category: "tooling",
    companions: ["observability"],
    details: {
      overview:
        "A drop-in ESLint flat-config fragment that bans console.* so logging goes through the structured logger instead of console.log technical debt. Spread it into your eslint.config.mjs.",
      includes: [
        "eslint.no-console.mjs exporting noConsoleConfig (a flat-config array)",
        "no-console at warn (the non-breaking default) or error",
        "Exempts the logger transport, server startup, scripts, config, and smoke-* diagnostics",
      ],
    },
  },

  // --- Adobe Firefly Services family (foundation → core generative → creative
  // automation → storage). Each service requires adobe-firefly-core (machine
  // Server-to-Server IMS) — handled by dependency resolution, not a conflict
  // with the end-user auth providers. ---
  {
    id: "adobe-firefly-core",
    category: "adobe",
    companions: ["adobe-firefly-storage-s3"],
    details: {
      overview:
        "Shared foundation every Adobe Firefly service builds on: IMS OAuth Server-to-Server token provider, a base REST client, the async job port (polling or webhook), a presigned-URL storage seam, and Adobe error classification. This is machine auth for calling Firefly APIs — unrelated to how your app's users sign in.",
      includes: [
        "IMS Server-to-Server token provider (cached; not the retired JWT flow)",
        "Base REST client (x-api-key + bearer, retry, timeout)",
        "Async FireflyJobPort — polling or webhook, transparently",
        "Presigned-URL storage seam (passthrough default; swap in an s3/gcs/azure addon)",
        "Typed FireflyError hierarchy + Result<T, FireflyError>",
      ],
    },
  },
  {
    id: "adobe-firefly-generate",
    category: "adobe",
    details: {
      overview:
        "The flagship Firefly service: text-to-image plus the image-edit operations (generative fill/expand, image-to-image, style transfer). Async; resolves to candidate output hrefs.",
      includes: [
        "ImageGenerationPort: textToImage + generativeFill/Expand/imageToImage/styleTransfer",
        "Posts the async /v3/images/*-async endpoints, awaits via the job port",
        "Content Credentials (C2PA) + safety as pass-through options",
        "Returns one href per requested variation",
      ],
    },
  },
  {
    id: "adobe-firefly-upscale",
    category: "adobe",
    details: {
      overview:
        "The lightest Firefly service: submit an async upscale job and get one output href. A good end-to-end validation of the foundation.",
      includes: [
        "UpscalePort.upscale(req) → single output href",
        "Posts /v3/images/upscale, awaits via the job port",
        "Default factor set at install (override per call)",
      ],
    },
  },
  {
    id: "adobe-firefly-composite",
    category: "adobe",
    details: {
      overview:
        "Composite Operations: blend a product image into a scene (matching tone, lighting, shadow). Returns an array of candidate composites.",
      includes: [
        "CompositePort.composite(product, scene) → string[] candidates",
        "Posts /v3/images/composite-async, awaits via the job port",
        "Candidate count + model configurable; C2PA/safety pass-through",
      ],
    },
  },
  {
    id: "adobe-firefly-content-tagging",
    category: "adobe",
    details: {
      overview:
        "The one Firefly service whose result is JSON, not an asset: structured tags/metadata for an image. Presigns the input only.",
      includes: [
        "ContentTaggingPort.tag(inputHref) → { tags, raw }",
        "Handles a sync response or a short async job",
        "Confidence floor configurable; no output storage needed",
      ],
    },
  },
  {
    id: "adobe-firefly-media",
    category: "adobe",
    details: {
      overview:
        "Audio/Video generation — the longest-running Firefly jobs (minutes): text-to-video, image-to-video, audio/video translation, speech, and sound effects.",
      includes: [
        "MediaGenerationPort: textToVideo / imageToVideo / translateAudioVideo / generateSpeech / soundEffect",
        "Posts /v3/videos/* + /v3/audio/* async, awaits via the job port (webhook-friendly)",
        "Partner models (Veo/Runway/Kling/ElevenLabs) as opaque model ids — no partner SDKs",
      ],
    },
  },
  {
    id: "adobe-firefly-custom-models",
    category: "adobe",
    details: {
      overview:
        "Custom Models lifecycle: train a brand-tuned model from a curated dataset, check status, list models, and generate with a trained model. Training is the longest job in the family.",
      includes: [
        "CustomModelPort: train / status / list / generateWith",
        "train awaits queued→training→completed, returns the trained model id",
        "generateWith runs inference with a trained model id",
        "Dataset caption format + base model configurable",
      ],
    },
  },
  {
    id: "adobe-photoshop",
    category: "adobe",
    details: {
      overview:
        "Photoshop automation on image.adobe.io: Smart Object replacement, text-layer edits, action JSON, crop, and PSD rendering. Inputs are named layers in a pre-authored .psd.",
      includes: [
        "PhotoshopAutomationPort: smartObject / editTextLayer / applyActionJson / crop / renderPsd",
        "Posts absolute image.adobe.io/pie/psdService URLs, waits via jobPort.poll",
        "Targets named Smart Object / text layers by name",
      ],
    },
  },
  {
    id: "adobe-lightroom",
    category: "adobe",
    details: {
      overview:
        "Lightroom automation on image.adobe.io: auto-tone, preset application, and parametric edits. Batch-oriented photo editing / colour grading.",
      includes: [
        "LightroomPort: autoTone / applyPreset / edit",
        "Posts absolute image.adobe.io/lrService URLs, waits via jobPort.poll",
        "Drive over many assets per call (or fan out with bullmq)",
      ],
    },
  },
  {
    id: "adobe-illustrator",
    category: "adobe",
    details: {
      overview:
        "Illustrator automation on image.adobe.io: artboard rendering, variable-data merge, and vector scaling (vector→raster at arbitrary scale — ads to billboards).",
      includes: [
        "IllustratorPort: renderArtboard / dataMerge / scaleVector",
        "Posts absolute image.adobe.io URLs, waits via jobPort.poll",
        "png/jpeg/pdf output; scale/width/height per request",
      ],
    },
  },
  {
    id: "adobe-indesign",
    category: "adobe",
    details: {
      overview:
        "InDesign automation on image.adobe.io: data merge (template + data source), layout rendering, and PDF export.",
      includes: [
        "InDesignPort: dataMerge / renderLayout / exportPdf",
        "Posts absolute image.adobe.io URLs, waits via jobPort.poll",
        "exportPdf always produces PDF regardless of the default format",
      ],
    },
  },
  {
    id: "adobe-express",
    category: "adobe",
    details: {
      overview:
        "Express batch automation on image.adobe.io: render many variants from a published Express template in one async batch job — the localization use case.",
      includes: [
        "ExpressAutomationPort.renderBatch(templateId, items[]) → one href per variant",
        "All-or-nothing batch with 1:1 output↔item alignment",
        "Singleton exported as expressAutomation (avoids the Express.js name clash)",
      ],
    },
  },
  {
    id: "adobe-creative-production",
    category: "adobe",
    details: {
      overview:
        "Creative Production batch automation on image.adobe.io: map a published workflow over N assets, surfacing per-asset status (partial success rather than failing the whole batch).",
      includes: [
        "CreativeProductionPort.runWorkflow(workflowId, assets[]) → AssetResult[]",
        "Per-asset succeeded/failed reported in-band, in request order",
        "Soft DB dependency for persisting batch status in your own store",
      ],
    },
  },
  {
    id: "adobe-substance-3d",
    category: "adobe",
    details: {
      overview:
        "Substance 3D automation on image.adobe.io: render a scene to an image, composite over a background, or relight with an HDRI. The longest-running image.adobe.io jobs.",
      includes: [
        "Substance3DPort: render / composite / relight",
        "Posts absolute image.adobe.io URLs, waits via jobPort.poll (no max-wait cap)",
        "composite / relight take an extra background plate / HDRI input",
      ],
    },
  },
  {
    id: "adobe-firefly-storage-s3",
    category: "adobe",
    details: {
      overview:
        "Registers an Amazon S3 presigner for the Firefly storage seam: presigns GET URLs for inputs and PUT URLs for outputs. Mutually exclusive with the GCS/Azure presigners.",
      includes: [
        "S3PresignStorageAdapter wired via setStoragePresigner (side-effect import)",
        "GET for inputs, PUT for outputs; an http(s) ref is passed through",
        "AWS credential chain; bucket/region/prefix read at presign time",
      ],
    },
  },
  {
    id: "adobe-firefly-storage-gcs",
    category: "adobe",
    details: {
      overview:
        "Registers a Google Cloud Storage presigner for the Firefly storage seam: V4 read/write signed URLs. Mutually exclusive with the S3/Azure presigners.",
      includes: [
        "GcsPresignStorageAdapter wired via setStoragePresigner (side-effect import)",
        "V4 read for inputs, V4 write for outputs; Google ADC credentials",
        "Keyless signing makes one IAM SignBlob call per URL; a key file signs locally",
      ],
    },
  },
  {
    id: "adobe-firefly-storage-azure",
    category: "adobe",
    details: {
      overview:
        "Registers an Azure Blob Storage presigner for the Firefly storage seam: read/create SAS URLs. Account-key or managed-identity (user-delegation) signing. Mutually exclusive with the S3/GCS presigners.",
      includes: [
        "AzureBlobPresignStorageAdapter wired via setStoragePresigner (side-effect import)",
        "Read SAS for inputs, create/write SAS for outputs",
        "Account-key or managed-identity user-delegation signing (delegation key cached)",
      ],
    },
  },
];

/**
 * The wizard catalog: each curated presentation merged with its manifest-derived
 * fields (name/description/requires/conflicts) from template-manifest.generated.ts.
 * A presentation entry with no manifest is a ghost — a card for a template that
 * doesn't exist — and is a hard error here. The reverse (a manifest with no
 * presentation) is caught by the parity test.
 */
export const TEMPLATE_CATALOG: CatalogEntry[] = PRESENTATION.map((p) => {
  const meta: TemplateManifestMeta | undefined = TEMPLATE_MANIFESTS[p.id];
  if (!meta) {
    throw new Error(
      `[template-catalog] presentation entry "${p.id}" has no manifest — ghost catalog entry (remove it or add the template).`,
    );
  }
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    requires: [...meta.requires],
    conflicts: [...meta.conflicts],
    category: p.category,
    details: p.details,
    ...(p.note ? { note: p.note } : {}),
    ...(p.companions ? { companions: p.companions } : {}),
  };
});

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

/**
 * The complete transitive set of templates that `candidateId` requires (directly
 * or via its dependencies) and that are not already selected. The full closure is
 * returned in one call so the add-ons step can prompt "X requires A · B · C — add
 * all?" in a single dialog rather than chaining one prompt per dependency. The
 * `requires` graph is sourced from the manifests (merged into each entry), so it
 * matches what the CLI's resolveDependencies() will do at install time.
 *
 * Fails fast on an invalid graph — a dangling `requires` (no catalog/manifest
 * entry) or a cycle — by throwing, mirroring the CLI's MissingTemplateError /
 * CyclicDependencyError. The generator's parity check guards the manifests, so in
 * practice this only fires during local development if a manifest regresses; we'd
 * rather surface that immediately than accept a selection that breaks at install.
 */
export function resolveMissingRequires(
  candidateId: string,
  selectedIds: string[],
): CatalogEntry[] {
  const have = new Set(selectedIds);
  const out: CatalogEntry[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  // Post-order DFS: a node is appended only after its own requirements, so the
  // closure is install-ordered (deepest deps first). `visiting` is the active
  // path — re-entering it means a cycle (distinct from a diamond, where a shared
  // dep is reached twice via different parents and is correctly deduped by `done`).
  function visit(id: string, requiredBy: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(
        `Cyclic template dependency detected at "${id}" (required by "${requiredBy}")`,
      );
    }
    const dep = CATALOG_BY_ID.get(id);
    if (!dep) {
      throw new Error(
        `Template "${requiredBy}" requires "${id}", which has no catalog/manifest entry`,
      );
    }
    visiting.add(id);
    for (const req of dep.requires) visit(req, id);
    visiting.delete(id);
    done.add(id);
    // Traverse the whole graph (even through already-selected deps) but only
    // surface the ones that are still missing.
    if (!have.has(id)) out.push(dep);
  }

  const root = CATALOG_BY_ID.get(candidateId);
  if (!root) {
    throw new Error(`Unknown template "${candidateId}"`);
  }
  // Keep the candidate on the active path so a back-edge to it is caught as a cycle.
  visiting.add(candidateId);
  for (const req of root.requires) visit(req, candidateId);
  visiting.delete(candidateId);
  return out;
}

export type SelectionPlan =
  | { kind: "deselect" }
  | { kind: "conflict"; conflicts: CatalogEntry[] }
  | { kind: "deps"; deps: CatalogEntry[] }
  | { kind: "select" };

/**
 * Decide what selecting `candidateId` should do, given the current selection.
 * Priority order:
 *   1. an already-selected template → deselect (always allowed);
 *   2. CONFLICTS first — so we never prompt to add a dependency for a template
 *      the user is about to swap out (the dependency prompt runs afterward on the
 *      post-switch selection, in the add-ons step);
 *   3. missing REQUIRED dependencies → prompt;
 *   4. otherwise → select directly.
 * Pure and side-effect-free so the whole flow is unit-testable.
 */
export function planSelection(
  candidateId: string,
  selectedIds: string[],
): SelectionPlan {
  if (selectedIds.includes(candidateId)) return { kind: "deselect" };
  const conflicts = findConflicts(candidateId, selectedIds);
  if (conflicts.length > 0) return { kind: "conflict", conflicts };
  const deps = resolveMissingRequires(candidateId, selectedIds);
  if (deps.length > 0) return { kind: "deps", deps };
  return { kind: "select" };
}

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  foundation: "Foundation",
  infrastructure: "Infrastructure",
  ai: "AI / LLM",
  auth: "Auth",
  adobe: "Adobe Firefly",
  tooling: "Tooling",
};

export const CATEGORIES = [
  "foundation",
  "infrastructure",
  "ai",
  "auth",
  "adobe",
  "tooling",
] as const satisfies CatalogCategory[];
