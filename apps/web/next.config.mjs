// apps/web/next.config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@hexagen/project-generation',
    '@hexagen/project-configuration',
  ],
  experimental: {
    turbopack: false, // webpack = stable in monorepos
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'app'), // correct alias for @/components/ etc.
    };
    return config;
  },
};

export default nextConfig;
