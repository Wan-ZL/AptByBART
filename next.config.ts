import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/aptbybart',
  env: {
    NEXT_PUBLIC_BASE_PATH: '/aptbybart',
  },
};

export default nextConfig;
