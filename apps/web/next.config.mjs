// apps/web/next.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monorepo root is two levels up from apps/web
const monorepoRoot = path.resolve(__dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,

  // Allow LAN IP access in dev (Next.js 15+ host validation)
  // Use wildcard for flexibility during development
  allowedDevOrigins: ["10.10.0.219", "localhost", "127.0.0.1"],

  // Workspace packages to transpile
  transpilePackages: [
    "@hexagen/agentic-interaction",
    "@hexagen/messaging",
    "@hexagen/monaco-orchestration",
    "@hexagen/project-configuration",
    "@hexagen/project-generation",
    "@hexagen/shared",
    "@hexagen/visualization",
    "@hexagen/web-driver",
    "@hexagen/wizard-orchestration",
  ],

  // Ensure proper build output handling for monorepo environments
  distDir: ".next",

  // Required for monorepo deployments - tells Next.js where to trace dependencies from
  outputFileTracingRoot: monorepoRoot,

  experimental: {
    // Allow importing from directories outside of the app (monorepo packages)
    externalDir: true,
  },

  // Webpack configuration for monorepo package resolution
  webpack: (config) => {
    // Resolve workspace packages from the monorepo root node_modules
    config.resolve.modules = [
      path.resolve(monorepoRoot, "node_modules"),
      "node_modules",
      ...(config.resolve.modules || []),
    ];

    // Resolve .js imports to .ts files (needed for ESM-style imports in TypeScript source)
    // This allows barrels to use .js extensions (correct for ESM) while webpack resolves to .ts
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };

    // Ensure proper resolution of @hexagen/* packages
    config.resolve.alias = {
      ...config.resolve.alias,
      "@hexagen/agentic-interaction": path.resolve(
        monorepoRoot,
        "packages/agentic-interaction/src",
      ),
      "@hexagen/messaging": path.resolve(
        monorepoRoot,
        "packages/messaging/src",
      ),
      "@hexagen/monaco-orchestration": path.resolve(
        monorepoRoot,
        "packages/monaco-orchestration/src",
      ),
      "@hexagen/project-configuration": path.resolve(
        monorepoRoot,
        "packages/project-configuration/src",
      ),
      "@hexagen/project-generation": path.resolve(
        monorepoRoot,
        "packages/project-generation/src",
      ),
      "@hexagen/shared": path.resolve(monorepoRoot, "packages/shared/src"),
      "@hexagen/visualization": path.resolve(
        monorepoRoot,
        "packages/visualization/src",
      ),
      "@hexagen/web-driver": path.resolve(
        monorepoRoot,
        "packages/web-driver/src",
      ),
      "@hexagen/wizard-orchestration": path.resolve(
        monorepoRoot,
        "packages/wizard-orchestration/src",
      ),
    };

    return config;
  },

  // Turbopack config (for dev mode)
  turbopack: {
    root: monorepoRoot,
    resolveAlias: {
      "@hexagen/agentic-interaction": path.resolve(
        monorepoRoot,
        "packages/agentic-interaction/src",
      ),
      "@hexagen/messaging": path.resolve(
        monorepoRoot,
        "packages/messaging/src",
      ),
      "@hexagen/monaco-orchestration": path.resolve(
        monorepoRoot,
        "packages/monaco-orchestration/src",
      ),
      "@hexagen/project-configuration": path.resolve(
        monorepoRoot,
        "packages/project-configuration/src",
      ),
      "@hexagen/project-generation": path.resolve(
        monorepoRoot,
        "packages/project-generation/src",
      ),
      "@hexagen/shared": path.resolve(monorepoRoot, "packages/shared/src"),
      "@hexagen/visualization": path.resolve(
        monorepoRoot,
        "packages/visualization/src",
      ),
      "@hexagen/web-driver": path.resolve(
        monorepoRoot,
        "packages/web-driver/src",
      ),
      "@hexagen/wizard-orchestration": path.resolve(
        monorepoRoot,
        "packages/wizard-orchestration/src",
      ),
    },
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
};

export default nextConfig;
