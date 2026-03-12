// apps/web/next.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Turbopack configuration (Next.js 16+ default bundler)
  turbopack: {
    // Set root to the current app directory for proper CI resolution
    root: __dirname,
    resolveAlias: {
      "@": path.join(__dirname, "app"),
    },
  },

  // Ensure proper build output handling for monorepo environments
  distDir: ".next",

  // Disable experimental features that might cause issues in CI
  experimental: {
    serverComponents: false,
  },

  // Explicitly set the project root for CI environments to prevent path resolution issues
  async redirects() {
    return [];
  },

  // Ensure proper handling of the build process in monorepos
  async rewrites() {
    return [];
  },
};

export default nextConfig;
