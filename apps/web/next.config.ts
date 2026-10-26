import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.NODE_ENV === 'development'
    ? (process.env.NEXT_DIST_DIR ?? '.next-dev')
    : (process.env.NEXT_DIST_DIR ?? '.next'),
  async rewrites() {
    // On Vercel, the project-level services rewrites route /api/* to the API service.
    // Keep this proxy only for running this Next app by itself during local development.
    if (process.env.VERCEL) return [];
    const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4100/api/v1').replace(/\/$/, '');
    return [{ source: '/api/v1/:path*', destination: `${apiTarget}/:path*` }];
  },
  async redirects() {
    return [{ source: '/book/:practiceId', destination: '/book?practiceId=:practiceId', permanent: false }];
  },
};

export default nextConfig;
