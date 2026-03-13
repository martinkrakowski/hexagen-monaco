// apps/web/next.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monorepo root is two levels up from apps/web
const monorepoRoot = path.resolve(__dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages to transpile
  transpilePackages: [
    "@hexagen/monaco-orchestration",
    "@hexagen/project-configuration",
    "@hexagen/project-generation",
    "@hexagen/shared",
    "@hexagen/web-driver",
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
  webpack: (config, { isServer }) => {
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
      "@hexagen/web-driver": path.resolve(
        monorepoRoot,
        "packages/web-driver/src",
      ),
    };

    return config;
  },

  // Turbopack config (for dev mode)
  turbopack: {
    root: monorepoRoot,
    resolveAlias: {
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
      "@hexagen/web-driver": path.resolve(
        monorepoRoot,
        "packages/web-driver/src",
      ),
    },
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
};

export default nextConfig;
