/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true,
  },
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
};

export default nextConfig;
