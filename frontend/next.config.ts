import type { NextConfig } from "next";

const backendUrl =
  process.env.BACKEND_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/auth/:path*",
          destination: `${backendUrl}/api/auth/:path*`,
        },
        {
          source: "/api/servers/:path*",
          destination: `${backendUrl}/api/servers/:path*`,
        },
        {
          source: "/api/:path*",
          destination: `${backendUrl}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
