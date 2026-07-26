import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // No standalone output — we run from the project root with bun,
  // which has access to all node_modules. Standalone is only needed
  // for serverless deployments where you want a minimal bundle.
  allowedDevOrigins: [
    "sns.1911915.xyz",
    "http://sns.1911915.xyz",
    "https://sns.1911915.xyz",
  ],
};

export default nextConfig;
