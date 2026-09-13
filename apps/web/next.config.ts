import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@paceon/shared', '@paceon/scheduler', '@paceon/books', '@paceon/ai-schema'],
};

export default nextConfig;
