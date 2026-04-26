// Public URL of the cloud app, derived from the process env. Used both by
// provisionSandbox (when creating a sandbox) and by the manage update
// pipeline (when refreshing daemon envs / writing sandbox-side configs).
export function getAppUrl(): string {
  const domain =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}`;
}
