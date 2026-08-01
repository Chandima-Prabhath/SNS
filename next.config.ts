import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  allowedDevOrigins: [
    "sns.1911915.xyz",
    "https://sns.1911915.xyz",
    "adoo.cloud.1911915.xyz",
    "https://adoo.cloud.1911915.xyz",
    "sns.cloud.1911915.xyz",
    "https://sns.cloud.1911915.xyz",
  ],
};

export default nextConfig;
