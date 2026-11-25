import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Lets the dev server be opened by address as well as by name (walk-throughs use the address).
  allowedDevOrigins: ["127.0.0.1"],
  partialPrefetching: true,
  // Five Star has its own page. Its "Make it move" app still runs in the generic runner.
  async redirects() {
    return [{ source: "/apps/five-star", destination: "/five-star", permanent: false }];
  },
};

export default nextConfig;
