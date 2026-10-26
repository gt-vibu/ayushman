import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next-codex-local'),
  // This app is mounted publicly at /platform by the root Vercel services config.
  // Local standalone development continues to use the root path.
  ...(process.env.VERCEL ? { basePath: '/platform' } : {}),
  async rewrites() {
    // Vercel's project-level /api/* rewrite routes browser API requests to the API service.
    if (process.env.VERCEL) return [];
    const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4100/api/v1').replace(/\/$/, '');
    return [{ source: '/api/v1/:path*', destination: `${apiTarget}/:path*` }];
  },
};

export default nextConfig;
