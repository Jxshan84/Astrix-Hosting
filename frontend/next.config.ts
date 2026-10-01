import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/servers/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:4000"}/api/servers/:path*`,
      },
      {
        source: "/api/auth/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:4000"}/api/auth/:path*`,
      },
      {
        source: "/api/support/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
