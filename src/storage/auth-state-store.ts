import type { Plugin } from "obsidian";
import type { GitHubAppAuthState, GitHubAppAuthStatus } from "../types/auth-types";

const isGitHubAppAuthStatus = (value: unknown): value is GitHubAppAuthStatus =>
  value === "disconnected" ||
  value === "connected" ||
  value === "refreshing" ||
  value === "reauth_required";

/**
 * Extracts only the supported shared GitHub App auth payload from raw plugin
 * data. Unknown or legacy shapes are ignored rather than partially trusted.
 */
export const extractGitHubAppAuthState = (data: unknown): GitHubAppAuthState | null => {
  if (!data || typeof data !== "object") {
    return null;
  }

  const auth = (data as { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object") {
    return null;
  }

  const obj = auth as Partial<GitHubAppAuthState>;
  if (obj.provider !== "githubApp") {
    return null;
  }

  return {
    provider: "githubApp",
    status: isGitHubAppAuthStatus(obj.status) ? obj.status : "disconnected",
    accessToken: obj.accessToken ?? "",
    refreshToken: obj.refreshToken ?? "",
    accessTokenExpiresAt: obj.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: obj.refreshTokenExpiresAt ?? null,
    githubUserLogin: obj.githubUserLogin ?? "",
    installationId: typeof obj.installationId === "number" ? obj.installationId : null,
    installationAccountLogin: obj.installationAccountLogin ?? "",
    selectedOwner: obj.selectedOwner ?? "",
    selectedRepo: obj.selectedRepo ?? "",
  };
};

/**
 * Keeps expiring GitHub App auth state separate from ordinary sync settings so
 * callers can update credentials without rewriting baseline, logs, or UI state.
 */
export class GitHubAppAuthStateStore {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load(): Promise<GitHubAppAuthState | null> {
    return extractGitHubAppAuthState(await this.plugin.loadData());
  }

  async save(state: GitHubAppAuthState | null): Promise<void> {
    const raw = ((await this.plugin.loadData()) ?? {}) as Record<string, unknown>;
    await this.plugin.saveData({
      ...raw,
      auth: state,
    });
  }

  async clear(): Promise<void> {
    await this.save(null);
  }
}
