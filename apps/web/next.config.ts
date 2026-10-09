import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Node 24에서 TypeScript CLI의 설정 출력이 비어 build가 중단되는 문제를 피한다.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
