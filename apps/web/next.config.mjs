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

  // Set Turbopack root for monorepo workspace resolution (Next.js 16+)
  // This must be an absolute path to the monorepo root so Turbopack can
  // resolve the 'next' package from node_modules at the workspace level
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
