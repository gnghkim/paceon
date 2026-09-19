import type { NextConfig } from 'next';
import { resolveAppVersion } from './app-version.mjs';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
  },
  transpilePackages: ['@paceon/shared', '@paceon/scheduler', '@paceon/books', '@paceon/ai-schema', '@paceon/pdf-schema'],
};

export default nextConfig;
