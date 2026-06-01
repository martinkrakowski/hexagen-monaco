// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Regenerate via `yarn workspace web gen:template-questions`.
// Source of truth: packages/template-engine/templates/<id>/manifest.json

import type { TemplateQuestion } from "./types";

export const TEMPLATE_QUESTIONS: Record<
  string,
  ReadonlyArray<TemplateQuestion>
> = {
  "adobe-creative-production": [],
  "adobe-express": [
    {
      id: "output_format",
      type: "select",
      prompt: "Default output format for rendered variants?",
      options: ["jpg", "png", "pdf"],
      default: "jpg",
    },
  ],
  "adobe-firefly-composite": [
    {
      id: "default_candidates",
      type: "select",
      prompt: "Default number of candidate composites to request?",
      options: ["1", "2", "3", "4"],
      default: "2",
    },
  ],
  "adobe-firefly-content-tagging": [
    {
      id: "min_confidence",
      type: "select",
      prompt: "Drop tags below this confidence (0-1)?",
      options: ["0", "0.5", "0.7"],
      default: "0.5",
    },
  ],
  "adobe-firefly-core": [
    {
      id: "ims_region",
      type: "select",
      prompt: "Adobe IMS region host?",
      options: ["ims-na1", "ims-eu1"],
      default: "ims-na1",
    },
    {
      id: "job_mode",
      type: "select",
      prompt: "How do async jobs report completion?",
      options: ["polling", "webhook"],
      default: "polling",
    },
    {
      id: "storage_mode",
      type: "select",
      prompt: "Presigned-URL storage for inputs/outputs?",
      options: ["passthrough", "addon"],
      default: "passthrough",
    },
    {
      id: "default_timeout_ms",
      type: "select",
      prompt: "Per-request timeout (ms)?",
      options: ["30000", "60000", "120000"],
      default: "60000",
    },
    {
      id: "max_retries",
      type: "select",
      prompt: "Max retries on transient failure?",
      options: ["0", "1", "2", "3"],
      default: "2",
    },
  ],
  "adobe-firefly-custom-models": [
    {
      id: "dataset_caption_format",
      type: "select",
      prompt: "Dataset caption format?",
      options: ["jsonl", "csv"],
      default: "jsonl",
    },
  ],
  "adobe-firefly-generate": [
    {
      id: "operations",
      type: "multiselect",
      prompt: "Which Generate operations will you use?",
      options: [
        "text-to-image",
        "generative-fill",
        "generative-expand",
        "image-to-image",
        "style-transfer",
      ],
      default: ["text-to-image"],
    },
    {
      id: "default_size",
      type: "select",
      prompt: "Default output size?",
      options: ["1024x1024", "2048x2048", "1792x1024"],
      default: "2048x2048",
    },
  ],
  "adobe-firefly-media": [
    {
      id: "partner_model",
      type: "boolean",
      prompt:
        "Acknowledge partner-model routing (Veo/Runway/Kling/ElevenLabs as opaque model ids where entitled)?",
      default: false,
    },
  ],
  "adobe-firefly-storage-azure": [
    {
      id: "url_expiry_seconds",
      type: "select",
      prompt: "Presigned-URL (SAS) lifetime (seconds)?",
      options: ["300", "900", "3600"],
      default: "900",
    },
  ],
  "adobe-firefly-storage-gcs": [
    {
      id: "url_expiry_seconds",
      type: "select",
      prompt: "Presigned-URL lifetime (seconds)?",
      options: ["300", "900", "3600"],
      default: "900",
    },
  ],
  "adobe-firefly-storage-s3": [
    {
      id: "url_expiry_seconds",
      type: "select",
      prompt: "Presigned-URL lifetime (seconds)?",
      options: ["300", "900", "3600"],
      default: "900",
    },
  ],
  "adobe-firefly-upscale": [
    {
      id: "default_factor",
      type: "select",
      prompt:
        "Default upscale factor? (override per call via UpscaleRequest.factor)",
      options: ["2", "4"],
      default: "2",
    },
  ],
  "adobe-illustrator": [
    {
      id: "operations",
      type: "multiselect",
      prompt: "Which Illustrator operations will you use?",
      options: ["renderArtboard", "dataMerge", "scaleVector"],
      default: ["renderArtboard"],
    },
    {
      id: "output_format",
      type: "select",
      prompt: "Default output format?",
      options: ["png", "jpeg", "pdf"],
      default: "png",
    },
  ],
  "adobe-ims-spa": [
    {
      id: "redirect_uri",
      type: "text",
      prompt: "OAuth callback URI?",
      default: "http://localhost:3000/api/auth/callback",
    },
    {
      id: "scopes",
      type: "text",
      prompt: "IMS OAuth scopes (comma-separated)?",
      default: "openid,AdobeID,read_organizations",
    },
    {
      id: "environment",
      type: "select",
      prompt: "IMS environment?",
      options: ["prod", "stage"],
      default: "prod",
    },
    {
      id: "auto_refresh",
      type: "boolean",
      prompt: "Auto-refresh access tokens before expiry?",
      default: true,
    },
    {
      id: "protected_paths",
      type: "text",
      prompt:
        "Path prefixes the middleware should require auth for (comma-separated)?",
      default: "/dashboard,/api/protected",
    },
  ],
  "adobe-indesign": [
    {
      id: "operations",
      type: "multiselect",
      prompt: "Which InDesign operations will you use?",
      options: ["dataMerge", "renderLayout", "exportPdf"],
      default: ["dataMerge"],
    },
    {
      id: "output_format",
      type: "select",
      prompt: "Default output format? (exportPdf is always PDF)",
      options: ["pdf", "jpg", "png"],
      default: "pdf",
    },
  ],
  "adobe-lightroom": [
    {
      id: "operations",
      type: "multiselect",
      prompt: "Which Lightroom operations will you use?",
      options: ["autoTone", "applyPreset", "edit"],
      default: ["autoTone"],
    },
    {
      id: "output_format",
      type: "select",
      prompt: "Default output format?",
      options: ["jpeg", "png"],
      default: "jpeg",
    },
  ],
  "adobe-photoshop": [
    {
      id: "operations",
      type: "multiselect",
      prompt: "Which Photoshop operations will you use?",
      options: [
        "smartObject",
        "editTextLayer",
        "applyActionJson",
        "crop",
        "renderPsd",
      ],
      default: ["smartObject"],
    },
    {
      id: "output_format",
      type: "select",
      prompt: "Default render output format?",
      options: ["jpeg", "png"],
      default: "jpeg",
    },
  ],
  "adobe-substance-3d": [
    {
      id: "operations",
      type: "multiselect",
      prompt: "Which Substance 3D operations will you use?",
      options: ["render", "composite", "relight"],
      default: ["render"],
    },
    {
      id: "output_format",
      type: "select",
      prompt: "Default output image format?",
      options: ["png", "jpg"],
      default: "png",
    },
  ],
  "agents-md": [
    {
      id: "project_description",
      type: "text",
      prompt: "One-sentence project description?",
      required: true,
    },
    {
      id: "architecture_style",
      type: "select",
      prompt: "Architecture style?",
      options: ["hexagonal", "layered", "feature-based", "monolith"],
      default: "hexagonal",
    },
    {
      id: "session_logging",
      type: "boolean",
      prompt: "Include session logging structure?",
      default: true,
    },
  ],
  "auth-mock": [
    {
      id: "session_cookie_name",
      type: "auto",
      derivedFrom: "shared-types.session_cookie_name",
    },
  ],
  "bedrock-agentcore-runtime": [
    {
      id: "aws_region",
      type: "select",
      prompt: "AWS region for AgentCore Runtime?",
      options: ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-2"],
      default: "us-west-2",
    },
    {
      id: "agent_name",
      type: "text",
      prompt: "AgentCore agent name?",
      default: "hexagen-agent",
    },
    {
      id: "protocol",
      type: "select",
      prompt: "Runtime protocol?",
      options: ["HTTP", "MCP", "A2A"],
      default: "HTTP",
    },
    {
      id: "build_type",
      type: "select",
      prompt: "Build type? (Container is required for a TypeScript runtime)",
      options: ["Container", "CodeZip"],
      default: "Container",
    },
    {
      id: "inbound_auth",
      type: "select",
      prompt: "Inbound auth on the runtime endpoint?",
      options: ["IAM", "OAuth"],
      default: "IAM",
    },
    {
      id: "provision",
      type: "select",
      prompt: "How to provision the runtime?",
      options: ["agentcore-cli", "cdk", "none"],
      default: "agentcore-cli",
    },
    {
      id: "deploy_ci",
      type: "boolean",
      prompt:
        "Generate a deploy GitHub Action (ARM64 build -> ECR -> create/update runtime)?",
      default: true,
    },
  ],
  "bedrock-agentcore-services": [
    {
      id: "services",
      type: "multiselect",
      prompt: "Which AgentCore services?",
      options: ["memory", "gateway", "identity"],
      default: ["memory", "gateway", "identity"],
    },
    {
      id: "memory_mode",
      type: "select",
      prompt: "Memory retention?",
      options: ["shortTerm", "longAndShortTerm"],
      default: "longAndShortTerm",
    },
    {
      id: "memory_strategies",
      type: "multiselect",
      prompt: "Long-term memory strategies?",
      options: ["SEMANTIC", "SUMMARY", "USER_PREFERENCE"],
      default: ["SEMANTIC", "SUMMARY"],
    },
    {
      id: "gateway_targets",
      type: "select",
      prompt: "Initial gateway tool source?",
      options: ["lambda", "openapi", "mcp", "none"],
      default: "lambda",
    },
    {
      id: "identity_idp",
      type: "select",
      prompt: "Identity provider to bridge to UserContext?",
      options: ["cognito", "okta", "entra", "auth0", "none"],
      default: "cognito",
    },
  ],
  "better-auth": [
    {
      id: "providers",
      type: "multiselect",
      prompt:
        "Which providers do you plan to use? (social providers activate from env at runtime; magic-link is opt-in via BETTER_AUTH_MAGIC_LINK)",
      options: ["email-password", "google", "github", "magic-link"],
      default: ["email-password", "google"],
    },
    {
      id: "database",
      type: "select",
      prompt:
        "Database adapter? (the scaffold ships Drizzle/Postgres; other choices require swapping the adapter import and regenerating the schema)",
      options: ["drizzle", "prisma", "kysely"],
      default: "drizzle",
    },
    {
      id: "session_expiry_days",
      type: "select",
      prompt: "Session expiry (days)?",
      options: ["1", "7", "30"],
      default: "7",
    },
    {
      id: "rate_limiting",
      type: "boolean",
      prompt: "Enable Better Auth built-in rate limiting?",
      default: true,
    },
  ],
  bullmq: [
    {
      id: "worker_mode",
      type: "select",
      prompt: "Where does the worker run?",
      options: ["same-process", "separate-service"],
      default: "same-process",
    },
    {
      id: "queue_names",
      type: "text",
      prompt: "Queue names (comma-separated)?",
      default: "default,images,notifications",
    },
    {
      id: "job_examples",
      type: "multiselect",
      prompt: "Generate example job types?",
      options: [
        "image-processing",
        "email",
        "webhook",
        "export",
        "ai-generation",
      ],
      default: [],
    },
    {
      id: "redis_source",
      type: "select",
      prompt: "Redis connection?",
      options: ["local", "redis-cloud", "upstash", "docker-compose"],
      default: "local",
    },
    {
      id: "concurrency",
      type: "select",
      prompt: "Default worker concurrency per queue?",
      options: ["1", "2", "5", "10"],
      default: "2",
    },
    {
      id: "bull_board",
      type: "boolean",
      prompt: "Include Bull Board web dashboard?",
      default: true,
    },
  ],
  "ci-github-actions": [
    {
      id: "ci_triggers",
      type: "multiselect",
      prompt: "When should CI run?",
      options: [
        "push-all-branches",
        "push-main-only",
        "pull-request",
        "manual",
      ],
      default: ["push-all-branches", "pull-request"],
    },
    {
      id: "deploy_target",
      type: "select",
      prompt: "Deploy target?",
      options: ["vercel", "railway", "fly-io", "vps-ssh", "none"],
      default: "vercel",
    },
    {
      id: "preview_deploys",
      type: "boolean",
      prompt:
        "PR preview deploys? (Vercel-based; pair with deploy_target vercel/railway)",
      default: true,
    },
    {
      id: "node_version",
      type: "select",
      prompt: "Node.js version?",
      options: ["20", "22", "23"],
      default: "22",
    },
    {
      id: "docker_build",
      type: "boolean",
      prompt:
        "Build and push a Docker image in CI? (the docker template owns docker-build.yml; this records the intent)",
      default: false,
    },
    {
      id: "run_tests",
      type: "boolean",
      prompt: "Run tests in CI?",
      default: true,
    },
    {
      id: "cache_strategy",
      type: "select",
      prompt: "Dependency cache strategy?",
      options: ["node-modules", "yarn-cache", "turbo-cache"],
      default: "turbo-cache",
    },
  ],
  clerk: [
    {
      id: "protected_paths",
      type: "text",
      prompt: "Path prefixes to protect?",
      default: "/dashboard,/api/protected",
    },
    {
      id: "org_features",
      type: "boolean",
      prompt: "Enable organisation/role features?",
      default: false,
    },
    {
      id: "jwt_template",
      type: "text",
      prompt: "JWT template name for API auth?",
      default: "default",
    },
  ],
  "design-system": [
    {
      id: "primary_color",
      type: "text",
      prompt: "Primary brand color (hex)?",
      default: "#6366f1",
      validation: {
        pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
        message: "Must be a 3- or 6-digit hex color, e.g. #6366f1",
      },
    },
    {
      id: "typography",
      type: "select",
      prompt: "Base font stack?",
      options: ["system-ui", "inter", "geist", "custom"],
      default: "geist",
    },
    {
      id: "dark_mode",
      type: "select",
      prompt:
        "Dark mode strategy? (shipped as class-toggle; DESIGN.md documents switching to media-query/none)",
      options: ["none", "css-class", "media-query", "both"],
      default: "css-class",
    },
    {
      id: "component_base",
      type: "select",
      prompt:
        "UI component base to grow the stubs toward? (stubs are framework-agnostic; install the chosen library yourself)",
      options: ["shadcn-ui", "radix-primitives", "headlessui", "none"],
      default: "shadcn-ui",
    },
    {
      id: "storybook",
      type: "boolean",
      prompt: "Set up Storybook?",
      default: false,
    },
  ],
  docker: [
    {
      id: "node_version",
      type: "select",
      prompt: "Node.js version?",
      options: ["20", "22", "23"],
      default: "22",
    },
    {
      id: "services",
      type: "multiselect",
      prompt: "Additional services in docker-compose?",
      options: ["redis", "postgres", "mailhog", "minio"],
      default: [],
    },
    {
      id: "registry",
      type: "select",
      prompt:
        "Container registry? (the generated workflow targets ghcr.io; ecr/docker-hub require switching the commented login/env steps in docker-build.yml)",
      options: ["ghcr", "ecr", "docker-hub", "none"],
      default: "ghcr",
    },
    {
      id: "health_path",
      type: "text",
      prompt:
        "HTTP path for the container health check? (use / for any app, or /api/health if you also install the observability template)",
      default: "/",
      validation: {
        pattern: "^/[a-zA-Z0-9/_.-]*$",
        message: "Must be a URL path starting with /, e.g. / or /api/health",
      },
    },
  ],
  "env-setup": [
    {
      id: "framework",
      type: "select",
      prompt: "Server framework?",
      options: ["next.js", "express", "fastify", "nitro"],
      default: "next.js",
    },
    {
      id: "strict_validation",
      type: "boolean",
      prompt: "Fail hard at startup if required env vars are missing?",
      default: true,
    },
    {
      id: "dotenv_tool",
      type: "select",
      prompt:
        "Env loader? (next.js-built-in for Next.js/Nitro — they parse .env natively; pick dotenv/dotenv-expand only for plain Node entrypoints)",
      options: ["next.js-built-in", "dotenv", "dotenv-expand"],
      default: "next.js-built-in",
    },
  ],
  "error-handling": [
    {
      id: "http_mapping",
      type: "select",
      prompt: "HTTP error mapping strategy?",
      options: ["status-codes", "rfc7807-problem-json", "custom"],
      default: "rfc7807-problem-json",
    },
    {
      id: "react_boundary",
      type: "boolean",
      prompt: "Generate React ErrorBoundary component?",
      default: true,
    },
    {
      id: "sentry",
      type: "boolean",
      prompt: "Integrate Sentry for error tracking?",
      default: false,
    },
  ],
  "eslint-no-console": [
    {
      id: "console_level",
      type: "select",
      prompt: "no-console severity? (warn nudges; error blocks CI)",
      options: ["warn", "error"],
      default: "warn",
    },
  ],
  "github-oauth": [
    {
      id: "redirect_uri",
      type: "text",
      prompt: "OAuth callback URI?",
      default: "http://localhost:3000/api/auth/callback/github",
    },
    {
      id: "scopes",
      type: "text",
      prompt: "OAuth scopes (comma-separated)?",
      default: "read:user,user:email",
    },
    {
      id: "allowed_orgs",
      type: "text",
      prompt:
        "Restrict to GitHub org members? (comma-separated org names, leave blank for any)",
      default: "",
    },
    {
      id: "protected_paths",
      type: "text",
      prompt:
        "Path prefixes the middleware should require auth for (comma-separated)?",
      default: "/dashboard,/api/protected",
    },
  ],
  "google-oauth": [
    {
      id: "redirect_uri",
      type: "text",
      prompt: "OAuth callback URI?",
      default: "http://localhost:3000/api/auth/callback/google",
    },
    {
      id: "scopes",
      type: "text",
      prompt: "OAuth scopes (comma-separated)?",
      default: "openid,email,profile",
    },
    {
      id: "hd",
      type: "text",
      prompt:
        "Restrict to Google Workspace domain? (leave blank for any Google account)",
      default: "",
    },
    {
      id: "protected_paths",
      type: "text",
      prompt:
        "Path prefixes the middleware should require auth for (comma-separated)?",
      default: "/dashboard,/api/protected",
    },
  ],
  langgraph: [
    {
      id: "deployment",
      type: "select",
      prompt: "LangGraph deployment target?",
      options: ["local", "langgraph-cloud", "self-hosted"],
      default: "local",
    },
    {
      id: "checkpointing",
      type: "select",
      prompt: "Checkpointing backend?",
      options: ["memory", "supabase", "redis", "postgres"],
      default: "memory",
    },
    {
      id: "streaming",
      type: "boolean",
      prompt: "Enable streaming token output?",
      default: false,
    },
    {
      id: "graph_type",
      type: "select",
      prompt: "Example graph to generate?",
      options: ["simple-chain", "research-agent"],
      default: "simple-chain",
    },
    {
      id: "human_in_loop",
      type: "boolean",
      prompt: "Include human-in-the-loop interrupt scaffolding?",
      default: false,
    },
  ],
  "llm-adapter": [
    {
      id: "providers",
      type: "multiselect",
      prompt: "Which LLM providers do you need?",
      options: ["xai", "openai", "anthropic", "ollama", "azure-openai"],
      default: ["xai"],
    },
    {
      id: "primary_provider",
      type: "select",
      prompt:
        "Primary provider for orchestration (must be one of the providers selected above)?",
      options: ["xai", "openai", "anthropic", "ollama", "azure-openai"],
      default: "xai",
    },
    {
      id: "reasoning_routing",
      type: "boolean",
      prompt: "Route orchestration calls to a dedicated reasoning model?",
      default: true,
    },
    {
      id: "structured_output",
      type: "boolean",
      prompt: "Need structured JSON output with Zod schema validation?",
      default: true,
    },
    {
      id: "streaming",
      type: "boolean",
      prompt: "Enable streaming responses?",
      default: false,
    },
    {
      id: "default_timeout_ms",
      type: "select",
      prompt: "Default request timeout (ms)?",
      options: ["15000", "30000", "60000", "120000"],
      default: "30000",
    },
    {
      id: "max_retries",
      type: "select",
      prompt: "Max retries on transient failure?",
      options: ["0", "1", "2", "3"],
      default: "2",
    },
  ],
  "llm-adapter-bedrock": [
    {
      id: "bedrock_region",
      type: "select",
      prompt:
        "Default AWS region for Bedrock? (code never hardcodes it — the SDK cascade resolves region; this only seeds .env.bedrock.example)",
      options: ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-2"],
      default: "us-west-2",
    },
    {
      id: "bedrock_inference",
      type: "select",
      prompt:
        "Default Bedrock inference-profile model id? (override per tier via BEDROCK_*_MODEL)",
      options: [
        "us.anthropic.claude-sonnet-4-20250514-v1:0",
        "us.amazon.nova-pro-v1:0",
        "us.meta.llama3-3-70b-instruct-v1:0",
      ],
      default: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    },
    {
      id: "bedrock_guardrails",
      type: "boolean",
      prompt:
        "Wire optional Bedrock Guardrails support (attached when BEDROCK_GUARDRAIL_ID is set)?",
      default: false,
    },
  ],
  "magic-link": [
    {
      id: "email_transport",
      type: "select",
      prompt: "Email transport?",
      options: ["resend", "nodemailer"],
      default: "resend",
    },
    {
      id: "from_address",
      type: "text",
      prompt: "From address for magic link emails?",
      default: "noreply@example.com",
    },
    {
      id: "token_ttl_minutes",
      type: "select",
      prompt: "Magic link expiry (minutes)?",
      options: ["5", "10", "15", "30"],
      default: "15",
    },
    {
      id: "app_url",
      type: "text",
      prompt: "Application base URL (used to build the magic link)?",
      default: "http://localhost:3000",
    },
    {
      id: "protected_paths",
      type: "text",
      prompt:
        "Path prefixes the middleware should require auth for (comma-separated)?",
      default: "/dashboard,/api/protected",
    },
  ],
  "microsoft-entra": [
    {
      id: "redirect_uri",
      type: "text",
      prompt: "OAuth callback URI?",
      default: "http://localhost:3000/api/auth/callback/entra",
    },
    {
      id: "scopes",
      type: "text",
      prompt: "API scopes (comma-separated)?",
      default: "openid,profile,email,User.Read",
    },
    {
      id: "group_role_mapping",
      type: "boolean",
      prompt: "Map AAD group object IDs to application roles?",
      default: false,
    },
    {
      id: "group_role_map",
      type: "text",
      prompt: 'Group role map JSON? (e.g. {"<oid>":"admin"})',
      default: "{}",
    },
    {
      id: "protected_paths",
      type: "text",
      prompt:
        "Path prefixes the middleware should require auth for (comma-separated)?",
      default: "/dashboard,/api/protected",
    },
  ],
  nextauth: [
    {
      id: "providers",
      type: "multiselect",
      prompt:
        "Which providers do you plan to use? (all are scaffolded; your selection is recorded in auth.config.ts to guide pruning)",
      options: ["google", "github", "credentials", "email"],
      default: ["google", "github"],
    },
    {
      id: "session_strategy",
      type: "select",
      prompt: "Session strategy?",
      options: ["jwt", "database"],
      default: "jwt",
    },
    {
      id: "protected_paths",
      type: "text",
      prompt: "Path prefixes to protect?",
      default: "/dashboard,/api/protected",
    },
    {
      id: "trust_host",
      type: "boolean",
      prompt: "Trust HOST header (needed for proxies)?",
      default: false,
    },
  ],
  observability: [
    {
      id: "log_format",
      type: "select",
      prompt: "Log format?",
      options: ["json", "pretty-dev", "auto"],
      default: "auto",
    },
    {
      id: "correlation_header",
      type: "select",
      prompt: "Correlation ID header name?",
      options: ["x-request-id", "x-correlation-id", "x-trace-id"],
      default: "x-request-id",
    },
    {
      id: "otel",
      type: "boolean",
      prompt: "Set up OpenTelemetry tracing?",
      default: false,
    },
  ],
  "rate-limiting": [
    {
      id: "framework",
      type: "select",
      prompt: "Which server framework?",
      options: ["nitro", "nextjs-api", "express", "fastify"],
      default: "nitro",
    },
    {
      id: "session_cookie_name",
      type: "text",
      prompt: "Session cookie name?",
      default: "__session",
    },
    {
      id: "differentiated",
      type: "boolean",
      prompt: "Differentiate limits by request type (text/image/general)?",
      default: true,
    },
    {
      id: "debug_logging",
      type: "boolean",
      prompt: "Enable proximity-to-limit debug logging?",
      default: true,
    },
    {
      id: "redis_backed",
      type: "boolean",
      prompt: "Use Redis for distributed rate limiting (multi-instance)?",
      default: false,
    },
  ],
  "shared-types": [
    {
      id: "session_cookie_name",
      type: "text",
      prompt:
        "Session cookie name? (used by the session-manager cookie helpers)",
      default: "__auth_session",
    },
  ],
  supabase: [
    {
      id: "project_url",
      type: "text",
      prompt: "Supabase project URL?",
      required: true,
    },
    {
      id: "anon_key",
      type: "text",
      prompt: "Supabase anon key? (public — safe in the browser)",
      required: true,
    },
    {
      id: "features",
      type: "multiselect",
      prompt:
        "Which Supabase features? (drives optional storage helper emission)",
      options: ["storage"],
      default: ["storage"],
    },
    {
      id: "storage_buckets",
      type: "text",
      prompt: "Storage bucket names (comma-separated)?",
      default: "uploads",
    },
    {
      id: "orm",
      type: "boolean",
      prompt: "Add a Drizzle ORM layer over the Supabase Postgres connection?",
      default: false,
    },
    {
      id: "type_gen",
      type: "boolean",
      prompt: "Include the type-generation script (supabase gen types)?",
      default: true,
    },
    {
      id: "rls_examples",
      type: "boolean",
      prompt: "Generate example RLS policies?",
      default: true,
    },
    {
      id: "realtime_example",
      type: "boolean",
      prompt: "Generate a realtime subscription example?",
      default: false,
    },
  ],
  "supabase-auth": [
    {
      id: "protected_paths",
      type: "text",
      prompt:
        "Path prefixes the middleware should require auth for (comma-separated)?",
      default: "/dashboard,/api/protected",
    },
  ],
};
