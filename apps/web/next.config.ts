import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // E2E는 사용자의 개발 서버와 build 산출물 잠금을 공유하지 않는다.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  experimental: {
    // Node 24에서 TypeScript CLI의 설정 출력이 비어 build가 중단되는 문제를 피한다.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
