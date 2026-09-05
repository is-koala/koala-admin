import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Nothing here exposes `env` to the client on purpose: no `env` block, no
  // `NEXT_PUBLIC_*`. The API base URL stays a server-side value.
  poweredByHeader: false,
  typedRoutes: true,
};

export default nextConfig;
