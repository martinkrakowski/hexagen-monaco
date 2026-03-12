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
    // Set root to monorepo root (two levels up from apps/web)
    root: path.join(__dirname, "..", ".."),
    resolveAlias: {
      "@": path.join(__dirname, "app"),
    },
  },
};

export default nextConfig;
