/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@punchclock/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
