import "dotenv/config";

const configuredJwtSecret = process.env.JWT_SECRET?.trim();
const configuredFrontendUrl = process.env.FRONTEND_URL?.trim();

if (!configuredJwtSecret || configuredJwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters.");
}

if (process.env.NODE_ENV === "production" && !configuredFrontendUrl) {
  throw new Error("FRONTEND_URL must be configured in production.");
}

export const jwtSecret = configuredJwtSecret;

function validateOrigin(value: string, label: string) {
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
    throw new Error(`${label} must be a secure origin without credentials, path, query, or fragment.`);
  }
  return url.origin;
}

export const frontendUrl = validateOrigin(
  configuredFrontendUrl || "http://localhost:3000",
  "FRONTEND_URL"
);

const configuredBackendUrl = process.env.BACKEND_URL?.trim();
if (process.env.NODE_ENV === "production" && configuredBackendUrl) {
  validateOrigin(configuredBackendUrl, "BACKEND_URL");
}

export function frontendRedirect(path: string) {
  return new URL(path, frontendUrl).toString();
}
