import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

// 컨테이너에서는 내부 API 주소를 지정하며, 로컬에서는 4000 포트로 전달한다.
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
