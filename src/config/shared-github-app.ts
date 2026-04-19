/**
 * Public metadata for the shared maintainer-owned GitHub App that the plugin
 * ships as its default auth path. This object must never contain secrets.
 */
export const SHARED_GITHUB_APP = {
  name: "obsidian-github-api-sync-app",
  clientId: "Iv23liBIw97hywWY5QvS",
  publicUrl: "https://github.com/apps/obsidian-github-api-sync-app",
  installUrl: "https://github.com/apps/obsidian-github-api-sync-app/installations/new",
} as const;
