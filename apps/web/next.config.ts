import path from 'node:path';
import type { NextConfig } from 'next';
import { resolveAppVersion } from './app-version.mjs';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
  },
  // nuc7 이미지는 standalone 서버를 쓴다. 모노레포 루트에서 추적해야 workspace 패키지가 함께 들어간다.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@paceon/shared', '@paceon/scheduler', '@paceon/books', '@paceon/ai-schema', '@paceon/pdf-schema'],
};

export default nextConfig;
