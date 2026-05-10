// apps/web/next.config.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monorepo root is two levels up from apps/web
const monorepoRoot = path.resolve(__dirname, '../..');

// Read version from root package.json
const pkg = JSON.parse(
  readFileSync(path.join(monorepoRoot, 'package.json'), 'utf-8')
);

// Capture git commit hash at build time (graceful fallback for environments
// where git may not be available, e.g. certain Docker build stages)
let gitHash = 'dev';
try {
  gitHash = execSync('git rev-parse --short HEAD', {
    cwd: monorepoRoot,
    timeout: 5000,
  })
    .toString()
    .trim();
} catch {
  // git unavailable — leave as 'dev'
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,

  // Allow LAN IP access in dev (Next.js 15+ host validation)
  // Use wildcard for flexibility during development
  allowedDevOrigins: ['10.10.0.219', 'localhost', '127.0.0.1'],

  // Workspace packages to transpile
  transpilePackages: [
    '@hexagen/agentic-interaction',
    '@hexagen/ai-pipeline',
    '@hexagen/byok',
    '@hexagen/core-domain',
    '@hexagen/eslint-plugin-ui',
    '@hexagen/governance',
    '@hexagen/local-llm',
    '@hexagen/messaging',
    '@hexagen/monaco-orchestration',
    '@hexagen/project-configuration',
    '@hexagen/project-generation',
    '@hexagen/prompt-compiler',
    '@hexagen/reconciliation-engine',
    '@hexagen/shared',
    '@hexagen/sync',
    '@hexagen/transaction-system',
    '@hexagen/ui',
    '@hexagen/ui-projection-compiler',
    '@hexagen/visualization',
    '@hexagen/web-driver',
    '@hexagen/wizard-orchestration',
  ],

  // Ensure proper build output handling for monorepo environments
  distDir: '.next',

  // Required for monorepo deployments - tells Next.js where to trace dependencies from
  outputFileTracingRoot: monorepoRoot,

  experimental: {
    // Allow importing from directories outside of the app (monorepo packages)
    externalDir: true,
  },

  // Injected at build time for observability (not runtime-configured secrets)
  env: {
    APP_VERSION: pkg.version,
    COMMIT_HASH: gitHash,
  },

  // Webpack configuration for monorepo package resolution
  webpack: (config) => {
    config.resolve.modules = [
      path.resolve(monorepoRoot, 'node_modules'),
      'node_modules',
      ...(config.resolve.modules || []),
    ];

    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };

    config.resolve.conditionNames = [
      'source',
      ...(config.resolve.conditionNames || []),
    ];

    return config;
  },

  turbopack: {
    root: monorepoRoot,
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },

  typescript: { ignoreBuildErrors: true },

  redirects: async () => [
    {
      source: '/',
      destination: '/projects',
      permanent: true,
    },
  ],
};

export default nextConfig;
