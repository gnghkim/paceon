import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@paceon/shared', '@paceon/scheduler', '@paceon/books'],
};

export default nextConfig;
