// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Regenerate via `yarn workspace web gen:template-questions`.
// Source of truth: packages/template-engine/templates/<id>/manifest.json

export interface TemplateManifestMeta {
  id: string;
  name: string;
  description: string;
  requires: readonly string[];
  conflicts: readonly string[];
}

export const TEMPLATE_MANIFESTS: Record<string, TemplateManifestMeta> = {
  "adobe-creative-production": {
    id: "adobe-creative-production",
    name: "Adobe Creative Production API",
    description:
      "Creative Production batch automation for Adobe Firefly Services (image.adobe.io): a CreativeProductionPort + adapter that maps a published workflow over N assets in one async batch job and surfaces per-asset status (partial success) over the adobe-firefly-core foundation. Async batch.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-express": {
    id: "adobe-express",
    name: "Adobe Express API",
    description:
      "Express batch automation for Adobe Firefly Services (image.adobe.io): an ExpressAutomationPort + adapter that renders many variants from a published Express template in one async batch job — the localization use case (translated copy + regional imagery per locale) over the adobe-firefly-core foundation. Async.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-firefly-composite": {
    id: "adobe-firefly-composite",
    name: "Adobe Firefly — Composite",
    description:
      "Composite Operations service for Adobe Firefly: a CompositePort + adapter that blends a product image into a scene (matching tone/lighting/shadow) over the adobe-firefly-core foundation. Async; returns multiple candidate outputs (the port returns an array of hrefs).",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-firefly-content-tagging": {
    id: "adobe-firefly-content-tagging",
    name: "Adobe Firefly — Content Tagging",
    description:
      "Content Tagging service for Adobe Firefly: a ContentTaggingPort + adapter that returns structured tags/metadata for an image (the one service whose result is JSON, not an asset — exercises the foundation's non-asset path). Sync or short async; presigns the input only.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-firefly-core": {
    id: "adobe-firefly-core",
    name: "Adobe Firefly Services — Core",
    description:
      "Shared foundation for Adobe Firefly Services: IMS OAuth Server-to-Server token provider (cached), a base REST client (x-api-key + bearer, retry, timeout), the async job port (polling or webhook), a presigned-URL storage seam (passthrough default), and Adobe error classification. Service addons require this and add one port + adapter each.",
    requires: ["env-setup", "error-handling"],
    conflicts: [],
  },
  "adobe-firefly-custom-models": {
    id: "adobe-firefly-custom-models",
    name: "Adobe Firefly — Custom Models",
    description:
      "Custom Models (training + inference) for Adobe Firefly Services (firefly-api.adobe.io): a CustomModelPort + adapter to train a brand-tuned model from a curated dataset, check status, list models, and generate with a trained model, over the adobe-firefly-core foundation. Async, long-running, webhook-friendly via FireflyJobPort.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-firefly-generate": {
    id: "adobe-firefly-generate",
    name: "Adobe Firefly — Generate",
    description:
      "Firefly Generate API (the flagship service): an ImageGenerationPort + adapter for text-to-image and the image-edit operations (generative fill/expand, image-to-image, style transfer) over the adobe-firefly-core foundation. Async via FireflyJobPort; presigned IO; content-credentials and safety flags pass through as port options.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-firefly-media": {
    id: "adobe-firefly-media",
    name: "Adobe Firefly — Audio/Video (Media)",
    description:
      "Audio/Video (Media) generation for Adobe Firefly Services (firefly-api.adobe.io): a MediaGenerationPort + adapter for text-to-video, image-to-video, audio/video translation, speech, and sound effects over the adobe-firefly-core foundation. Async and LONG (minutes) via FireflyJobPort; webhook job_mode strongly recommended. Partner models (Veo/Runway/Kling/ElevenLabs) are opaque model ids where entitled — no partner SDKs.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-firefly-storage-azure": {
    id: "adobe-firefly-storage-azure",
    name: "Adobe Firefly — Azure Blob Presigned Storage",
    description:
      'Registers an Azure Blob Storage presigner for the adobe-firefly-core storage seam: mints read SAS URLs for Firefly inputs and create/write SAS URLs for outputs (storage: "external"). Signs with an account key, or a managed-identity user-delegation key when no key is set. Mutually exclusive with the S3/GCS presigners. Install @azure/storage-blob + @azure/identity.',
    requires: ["adobe-firefly-core"],
    conflicts: ["adobe-firefly-storage-s3", "adobe-firefly-storage-gcs"],
  },
  "adobe-firefly-storage-gcs": {
    id: "adobe-firefly-storage-gcs",
    name: "Adobe Firefly — GCS Presigned Storage",
    description:
      'Registers a Google Cloud Storage presigner for the adobe-firefly-core storage seam: signs V4 read URLs for Firefly inputs and V4 write URLs for outputs (storage: "external"). Mutually exclusive with the S3/Azure presigners. Install @google-cloud/storage.',
    requires: ["adobe-firefly-core"],
    conflicts: ["adobe-firefly-storage-s3", "adobe-firefly-storage-azure"],
  },
  "adobe-firefly-storage-s3": {
    id: "adobe-firefly-storage-s3",
    name: "Adobe Firefly — S3 Presigned Storage",
    description:
      'Registers an Amazon S3 presigner for the adobe-firefly-core storage seam: presigns GET URLs for Firefly inputs and PUT URLs for outputs (storage: "external"). Mutually exclusive with the GCS/Azure presigners. Install @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner.',
    requires: ["adobe-firefly-core"],
    conflicts: ["adobe-firefly-storage-gcs", "adobe-firefly-storage-azure"],
  },
  "adobe-firefly-upscale": {
    id: "adobe-firefly-upscale",
    name: "Adobe Firefly — Upscale",
    description:
      "Image Upscale service for Adobe Firefly. Adds an UpscalePort + adapter that submits an async upscale job through the adobe-firefly-core foundation (IMS auth, REST client, job port, presigned storage). The lightest service — a good end-to-end validation of the foundation.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-illustrator": {
    id: "adobe-illustrator",
    name: "Adobe Illustrator API",
    description:
      "Illustrator automation for Adobe Firefly Services (image.adobe.io): an IllustratorPort + adapter for artboard rendering, variable-data merge, and vector scaling (vector→raster at arbitrary scale — ads to billboards) over the adobe-firefly-core foundation. Async.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-ims-spa": {
    id: "adobe-ims-spa",
    name: "Adobe IMS SPA (PKCE)",
    description:
      "Modern Adobe IMS Single Page App + PKCE flow: login, callback, logout routes, AES-256-GCM token store, silent auto-refresh, and a root middleware that protects configured paths and validates IMS sessions while still honouring AUTH_MODE=mock as a dev short-circuit.",
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
  },
  "adobe-indesign": {
    id: "adobe-indesign",
    name: "Adobe InDesign API",
    description:
      "InDesign automation for Adobe Firefly Services (image.adobe.io): an InDesignPort + adapter for data merge (template + data source), layout rendering, and PDF export over the adobe-firefly-core foundation. Async.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-lightroom": {
    id: "adobe-lightroom",
    name: "Adobe Lightroom API",
    description:
      "Lightroom automation for Adobe Firefly Services (image.adobe.io/lrService): a LightroomPort + adapter for auto-tone, preset application, and parametric edits over the adobe-firefly-core foundation. Async, batch-oriented photo editing / color grading.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-photoshop": {
    id: "adobe-photoshop",
    name: "Adobe Photoshop API",
    description:
      "Photoshop automation for Adobe Firefly Services (image.adobe.io/pie/psdService): a PhotoshopAutomationPort + adapter for Smart Object replacement, text-layer edits, action JSON, crop, and PSD rendering over the adobe-firefly-core foundation. Async; inputs are named layers in a pre-authored .psd.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "adobe-substance-3d": {
    id: "adobe-substance-3d",
    name: "Adobe Substance 3D API",
    description:
      "Substance 3D automation for Adobe Firefly Services (image.adobe.io): a Substance3DPort + adapter for scene render, composite, and relight over the adobe-firefly-core foundation. Async, compute-heavy — the longest-running Firefly jobs; polled by status URL (image.adobe.io services don't deliver Firefly webhooks) and the poll has no max-wait cap, so long renders aren't cut off.",
    requires: ["adobe-firefly-core"],
    conflicts: [],
  },
  "agents-md": {
    id: "agents-md",
    name: "AGENTS.md",
    description:
      "Rich AGENTS.md with mode system, tech stack reference, commands-after-edits table, and companion .agents/ spec directory",
    requires: [],
    conflicts: [],
  },
  "auth-mock": {
    id: "auth-mock",
    name: "Auth Mock",
    description:
      "Dev-only root middleware that injects shared-types' MOCK_USER as x-user-context when AUTH_MODE=mock. Real auth providers ship their own middleware that overwrites this one and still honours AUTH_MODE=mock as a dev short-circuit.",
    requires: ["shared-types", "env-setup"],
    conflicts: [],
  },
  "bedrock-agentcore-runtime": {
    id: "bedrock-agentcore-runtime",
    name: "Bedrock AgentCore Runtime",
    description:
      "Deploy the Hexagen TypeScript server to Amazon Bedrock AgentCore Runtime as an ARM64 container implementing the HTTP contract (POST /invocations, GET /ping). Generates agentcore.json, an IAM execution policy, and an optional deploy GitHub Action — no Python agent scaffolding.",
    requires: ["docker", "env-setup"],
    conflicts: [],
  },
  "bedrock-agentcore-services": {
    id: "bedrock-agentcore-services",
    name: "Bedrock AgentCore Services",
    description:
      "Hexagonal ports + adapters for Amazon Bedrock AgentCore stateful services — Memory (multi-turn + long-term recall), Gateway (APIs/Lambdas/MCP as MCP tools), and Identity (workload token + IdP claim bridge to UserContext). The application layer depends only on the ports; install @aws-sdk/client-bedrock-agentcore.",
    requires: ["env-setup"],
    conflicts: [],
  },
  "better-auth": {
    id: "better-auth",
    name: "Better Auth",
    description:
      "Standalone Better Auth server: email/password + Google/GitHub social providers, magic-link plugin, built-in rate limiting, typed auth client, and core DB schema + migration",
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
  },
  bullmq: {
    id: "bullmq",
    name: "BullMQ",
    description:
      "Typed BullMQ job queues with workers, scheduler, Redis fallback to in-process sync execution, optional Bull Board dashboard, and per-queue routing. Designed for background processing (image generation, email, webhooks, exports) where tasks are too slow for request/response cycles.",
    requires: ["env-setup"],
    conflicts: [],
  },
  "ci-github-actions": {
    id: "ci-github-actions",
    name: "CI / GitHub Actions",
    description:
      "GitHub Actions CI (build/typecheck/lint/test) with Turbo cache, a per-target deploy workflow (Vercel/Railway/Fly.io/VPS), optional PR preview deploys, and Dependabot",
    requires: [],
    conflicts: [],
  },
  clerk: {
    id: "clerk",
    name: "Clerk",
    description:
      "Standalone Clerk integration: clerkMiddleware route protection, server-side auth helpers, org/app-level RoleGuard component, protected route group, and a JWT-template API example",
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
  },
  "design-system": {
    id: "design-system",
    name: "Design System",
    description:
      "Populated DESIGN.md contract, CSS custom property tokens, Tailwind config extension, base component stubs",
    requires: [],
    conflicts: [],
  },
  docker: {
    id: "docker",
    name: "Docker",
    description:
      "Multi-stage Dockerfile, docker-compose with peer services, dev override for hot reload, GitHub Actions image push",
    requires: [],
    conflicts: [],
  },
  "env-setup": {
    id: "env-setup",
    name: "Env Setup",
    description:
      "Categorised .env.example, Zod runtime validation, check-env script, and SETUP.md first-day guide",
    requires: [],
    conflicts: [],
  },
  "error-handling": {
    id: "error-handling",
    name: "Error Handling",
    description:
      "3-layer error hierarchy, Result<T,E> type, RFC 7807 HTTP mapping, React error boundary",
    requires: ["env-setup"],
    conflicts: [],
  },
  "eslint-no-console": {
    id: "eslint-no-console",
    name: "ESLint — no-console (logger enforcement)",
    description:
      "A drop-in ESLint flat-config fragment that bans console.* (no-console) so logging goes through the structured logger instead of console.log technical debt — with the logger transport, server startup, CLI scripts, and config files exempted. Spread it into your eslint.config.mjs.",
    requires: [],
    conflicts: [],
  },
  "github-oauth": {
    id: "github-oauth",
    name: "GitHub OAuth",
    description:
      "GitHub OAuth App integration: code exchange, primary-email fetch, org-membership gate, AES-256-GCM stateless session cookie, and a root middleware that protects configured paths while still honouring AUTH_MODE=mock as a dev short-circuit.",
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
  },
  "google-oauth": {
    id: "google-oauth",
    name: "Google OAuth 2.0",
    description:
      "Server-side Google OAuth 2.0: authorization code flow, userinfo fetch, AES-256-GCM session cookie, optional hosted-domain restriction, and a root middleware that protects configured paths while still honouring AUTH_MODE=mock as a dev short-circuit.",
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
  },
  langgraph: {
    id: "langgraph",
    name: "LangGraph",
    description:
      "Hexagonal LangGraph integration: typed AgentGraphPort, shared GraphState, node files, conditional edge routing, swap-by-env checkpointers (memory/supabase/redis/postgres), and Next.js routes for invoke / optional streaming / optional human-in-the-loop resume. Comes with one of two working example graphs (simple-chain or research-agent) so the wiring is end-to-end out of the box.",
    requires: ["env-setup", "llm-adapter"],
    conflicts: [],
  },
  "llm-adapter": {
    id: "llm-adapter",
    name: "LLM Adapter",
    description:
      "Typed port interface, provider adapters (xAI, OpenAI, Anthropic, Ollama, Azure OpenAI), model constants, reasoning routing, retry logic, structured output",
    requires: ["env-setup", "error-handling"],
    conflicts: [],
  },
  "llm-adapter-bedrock": {
    id: "llm-adapter-bedrock",
    name: "LLM Adapter — Amazon Bedrock",
    description:
      "Adds Amazon Bedrock as an LLM provider (Converse API) to the llm-adapter router via the provider-registration seam — no base files overwritten. Auth uses the AWS credential chain; install @aws-sdk/client-bedrock-runtime.",
    requires: ["llm-adapter", "error-handling", "env-setup"],
    conflicts: [],
  },
  "magic-link": {
    id: "magic-link",
    name: "Magic Link (Passwordless)",
    description:
      "HMAC-SHA256 signed single-use tokens, Resend/Nodemailer transport, 10k-entry LRU replay store, AES-256-GCM stateless session cookie, and a root middleware that protects configured paths while still honouring AUTH_MODE=mock as a dev short-circuit.",
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
  },
  "mcp-server": {
    id: "mcp-server",
    name: "MCP Server (stdio)",
    description:
      "Expose the project's application use-cases as MCP tools over stdio — an inbound adapter with a static tool registry, a transport-factory seam, and a dynamic SDK import (ADR-0010).",
    requires: ["env-setup"],
    conflicts: [],
  },
  "microsoft-entra": {
    id: "microsoft-entra",
    name: "Microsoft Entra ID (Azure AD)",
    description:
      "Entra ID confidential-client PKCE flow, Microsoft Graph profile + group fetch, AAD group-to-role mapping, AES-256-GCM stateless session cookie, and a root middleware that protects configured paths while still honouring AUTH_MODE=mock as a dev short-circuit.",
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
  },
  nextauth: {
    id: "nextauth",
    name: "Auth.js (NextAuth v5)",
    description:
      "Standalone Auth.js v5 setup: Google/GitHub/Credentials providers, Edge-safe config split, JWT session strategy, typed session.user, and matcher-based route protection middleware",
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
  },
  observability: {
    id: "observability",
    name: "Observability",
    description:
      "Structured JSON logging, correlation IDs via AsyncLocalStorage, request logger middleware, /api/health endpoint",
    requires: [],
    conflicts: [],
  },
  "rate-limiting": {
    id: "rate-limiting",
    name: "Rate Limiting",
    description:
      "Differentiated middleware (text/image/general), session+IP hybrid identification, configurable limits, debug logging",
    requires: ["env-setup"],
    conflicts: [],
  },
  "shared-types": {
    id: "shared-types",
    name: "Shared Types",
    description:
      "Foundation library shared by every auth template: UserContext domain type, a runtime-overridable MOCK_USER for development, and generic AES-256-GCM session-cookie helpers (including the canonical COOKIE_NAME resolver). Carries no opinion about mock vs. real auth.",
    requires: ["env-setup"],
    conflicts: [],
  },
  supabase: {
    id: "supabase",
    name: "Supabase",
    description:
      "SSR-safe browser/server/admin clients, Result-based storage helpers, RLS examples, type generation, optional Drizzle ORM and realtime. Pure storage/database layer — no auth code. Add the supabase-auth template to layer @supabase/ssr-based session middleware on top.",
    requires: ["env-setup"],
    conflicts: [],
  },
  "supabase-auth": {
    id: "supabase-auth",
    name: "Supabase Auth",
    description:
      "Authentication provider built on Supabase: @supabase/ssr root middleware that refreshes the session and protects configured paths, getCurrentUser/requireAuth helpers, and /api/auth/me — all honouring AUTH_MODE=mock as a dev short-circuit. Layer on top of the supabase template.",
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
  },
};
