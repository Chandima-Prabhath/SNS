import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow the dev server to be accessed via the production domain (e.g. when
  // running `bun run dev` locally but tunnelling it through Cloudflare Tunnel
  // to sns.1911915.xyz). Without this, Next.js logs a cross-origin warning and
  // in a future major version will refuse to serve /_next/* resources.
  allowedDevOrigins: [
    "sns.1911915.xyz",
    "http://sns.1911915.xyz",
    "https://sns.1911915.xyz",
  ],
};

export default nextConfig;
