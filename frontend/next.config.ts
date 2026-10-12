import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "") ||
  (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:4000");

if (!backendUrl) {
  throw new Error("BACKEND_URL must be configured for production builds.");
}

function validateBackendOrigin(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) origin.`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) {
    throw new Error(`${label} must be an exact HTTPS origin in production.`);
  }
  return url.origin;
}

const validatedBackendUrl = validateBackendOrigin(backendUrl, "BACKEND_URL");
const publicBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
if (process.env.NODE_ENV === "production" && !publicBackendUrl) {
  throw new Error("NEXT_PUBLIC_BACKEND_URL must be configured for the production server console.");
}
if (publicBackendUrl) validateBackendOrigin(publicBackendUrl, "NEXT_PUBLIC_BACKEND_URL");

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/support/tickets",
          destination: `${validatedBackendUrl}/api/tickets`,
        },
        {
          source: "/api/support/tickets/:path*",
          destination: `${validatedBackendUrl}/api/tickets/:path*`,
        },
        {
          source: "/api/support/admin/:path*",
          destination: `${validatedBackendUrl}/api/admin/:path*`,
        },
        {
          source: "/api/auth/:path*",
          destination: `${validatedBackendUrl}/api/auth/:path*`,
        },
        {
          source: "/api/servers/:path*",
          destination: `${validatedBackendUrl}/api/servers/:path*`,
        },
        {
          source: "/api/:path*",
          destination: `${validatedBackendUrl}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
