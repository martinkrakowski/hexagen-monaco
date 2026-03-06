import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@hexagen/project-generation',
    '@hexagen/project-configuration',
  ],
  // turbopack: {
  //   root: __dirname, // ← apps/web itself (where next/package.json lives)
  // },
  experimental: {
    turbopack: false,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve('./app'),
    };
    return config;
  },
};

export default nextConfig;
