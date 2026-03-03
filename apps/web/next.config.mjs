import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@hexagen/project-generation',
    '@hexagen/project-configuration',
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Ensure this points to the folder containing 'lib'
      '@': path.resolve('./app'),
    };
    return config;
  },
};

export default nextConfig;
