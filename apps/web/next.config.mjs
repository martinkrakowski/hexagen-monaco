// apps/web/next.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@hexagen/project-generation",
    "@hexagen/project-configuration",
  ],

  // Turbopack configuration (Next.js 16+ default bundler)
  turbopack: {
    resolveAlias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
};

export default nextConfig;
