import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Lets the dev server be opened by address as well as by name (walk-throughs use the address).
  allowedDevOrigins: ["127.0.0.1"],
  partialPrefetching: true,
};

export default nextConfig;
