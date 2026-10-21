import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : (process.env.NEXT_DIST_DIR ?? '.next'),
  async rewrites() {
    const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4100/api/v1').replace(/\/$/, '');
    return [{ source: '/api/v1/:path*', destination: `${apiTarget}/:path*` }];
  },
};

export default nextConfig;
