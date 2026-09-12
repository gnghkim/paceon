import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@paceon/shared', '@paceon/scheduler'],
};

export default nextConfig;
