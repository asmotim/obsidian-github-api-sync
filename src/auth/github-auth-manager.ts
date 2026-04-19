import type { Plugin } from "obsidian";
import { GitHubAppDeviceFlowClient, GitHubAppOAuthError } from "./github-app-device-flow";
import { SHARED_GITHUB_APP } from "../config/shared-github-app";
import { GitHubAppAuthStateStore } from "../storage/auth-state-store";
import type {
  GitHubAppAuthState,
  GitHubAppDeviceFlowPollResult,
  GitHubAppDeviceFlowSession,
  GitHubAppRepository,
  GitHubAppTokenResponse,
} from "../types/auth-types";
import type { PluginSettings } from "../types/plugin-settings";

type PluginWithSettings = Plugin & {
  settings: PluginSettings;
};

type GitHubAuthManagerOptions = {
  deviceFlowClient?: GitHubAppDeviceFlowClient;
  now?: () => number;
};

export type GitHubAuthSession = {
  accessToken: string;
};

/**
 * Owns the end-user GitHub App session inside local plugin storage.
 *
 * The manager is the single place that is allowed to decide when a stored token
 * may still be used, when a refresh must happen, and when the user must
 * reconnect through the device flow again.
 */
export class GitHubAuthManager {
  private static readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  private plugin: PluginWithSettings;
  private authStateStore: GitHubAppAuthStateStore;
  private deviceFlowClient: GitHubAppDeviceFlowClient;
  private now: () => number;

  constructor(plugin: PluginWithSettings, options: GitHubAuthManagerOptions = {}) {
    this.plugin = plugin;
    this.authStateStore = new GitHubAppAuthStateStore(plugin);
    this.deviceFlowClient = options.deviceFlowClient ?? new GitHubAppDeviceFlowClient();
    this.now = options.now ?? (() => Date.now());
  }

  async ensureAuthenticatedSession(): Promise<GitHubAuthSession> {
    const authState = await this.authStateStore.load();
    if (!authState || authState.accessToken.trim().length === 0) {
      throw new Error("GitHub App authentication is not connected yet.");
    }

    const resolvedState = await this.refreshGitHubAppAuthState(authState, false);

    return {
      accessToken: resolvedState.accessToken.trim(),
    };
  }

  async loadGitHubAppAuthState(): Promise<GitHubAppAuthState | null> {
    return this.authStateStore.load();
  }

  async startDeviceFlow(): Promise<GitHubAppDeviceFlowSession> {
    return this.deviceFlowClient.startDeviceFlow(this.requireGitHubAppClientId());
  }

  async pollDeviceFlow(session: GitHubAppDeviceFlowSession): Promise<GitHubAppDeviceFlowPollResult> {
    return this.deviceFlowClient.pollForToken(session);
  }

  async completeDeviceFlow(token: GitHubAppTokenResponse): Promise<void> {
    const viewer = await this.deviceFlowClient.getViewer(token.accessToken);
    await this.authStateStore.save({
      provider: "githubApp",
      status: "connected",
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      githubUserLogin: viewer.login,
      installationId: null,
      installationAccountLogin: "",
      selectedOwner: this.plugin.settings.owner,
      selectedRepo: this.plugin.settings.repo,
    });
  }

  async disconnectGitHubApp(): Promise<void> {
    await this.authStateStore.clear();
  }

  async listAvailableRepositories(): Promise<GitHubAppRepository[]> {
    const { accessToken } = await this.ensureAuthenticatedSession();
    const installations = await this.deviceFlowClient.listInstallations(accessToken);
    const repositories = await Promise.all(
      installations.map((installation) =>
        this.deviceFlowClient.listInstallationRepositories(accessToken, installation)
      )
    );

    const uniqueRepositories = new Map<string, GitHubAppRepository>();
    for (const repository of repositories.flat()) {
      uniqueRepositories.set(repository.fullName.toLowerCase(), repository);
    }

    return Array.from(uniqueRepositories.values()).sort((left, right) =>
      left.fullName.localeCompare(right.fullName)
    );
  }

  async pickPreferredRepository(
    repositories: GitHubAppRepository[],
    currentSelection: { owner: string; repo: string }
  ): Promise<GitHubAppRepository | null> {
    if (repositories.length === 0) {
      return null;
    }

    const currentFullName = this.toFullName(currentSelection.owner, currentSelection.repo);
    if (currentFullName) {
      const currentRepository = repositories.find(
        (repository) => repository.fullName.toLowerCase() === currentFullName
      );
      if (currentRepository) {
        return currentRepository;
      }
    }

    const authState = await this.authStateStore.load();
    const rememberedFullName = this.toFullName(authState?.selectedOwner, authState?.selectedRepo);
    if (rememberedFullName) {
      const rememberedRepository = repositories.find(
        (repository) => repository.fullName.toLowerCase() === rememberedFullName
      );
      if (rememberedRepository) {
        return rememberedRepository;
      }
    }

    if (repositories.length === 1) {
      return repositories[0] ?? null;
    }

    return null;
  }

  async rememberSelectedRepository(repository: GitHubAppRepository): Promise<void> {
    const authState = await this.authStateStore.load();
    if (!authState) {
      return;
    }

    await this.authStateStore.save({
      ...authState,
      installationId: repository.installationId,
      installationAccountLogin: repository.accountLogin,
      selectedOwner: repository.owner,
      selectedRepo: repository.repo,
    });
  }

  async handleAuthenticationFailure(): Promise<string | null> {
    const authState = await this.authStateStore.load();
    if (!authState || authState.refreshToken.trim().length === 0) {
      return null;
    }

    const refreshedState = await this.refreshGitHubAppAuthState(authState, true);
    return refreshedState.accessToken.trim();
  }

  private async refreshGitHubAppAuthState(
    authState: GitHubAppAuthState,
    force: boolean
  ): Promise<GitHubAppAuthState> {
    if (!force && !this.isRefreshNeeded(authState.accessTokenExpiresAt)) {
      return authState;
    }

    const refreshToken = authState.refreshToken.trim();
    if (refreshToken.length === 0) {
      if (!force && !this.isExpired(authState.accessTokenExpiresAt)) {
        return authState;
      }

      await this.markReauthenticationRequired(authState);
      throw new Error("GitHub App authentication must be reconnected.");
    }

    const clientId = this.requireGitHubAppClientId();
    await this.authStateStore.save({
      ...authState,
      status: "refreshing",
    });

    try {
      const refreshedToken = await this.deviceFlowClient.refreshUserAccessToken(clientId, refreshToken);
      const refreshedState: GitHubAppAuthState = {
        ...authState,
        status: "connected",
        accessToken: refreshedToken.accessToken,
        refreshToken: refreshedToken.refreshToken,
        accessTokenExpiresAt: refreshedToken.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshedToken.refreshTokenExpiresAt,
      };
      await this.authStateStore.save(refreshedState);
      return refreshedState;
    } catch (error) {
      if (error instanceof GitHubAppOAuthError && error.code === "bad_refresh_token") {
        await this.markReauthenticationRequired(authState);
        throw new Error("GitHub App authentication must be reconnected.");
      }

      await this.authStateStore.save({
        ...authState,
        status: "connected",
      });

      if (!force && !this.isExpired(authState.accessTokenExpiresAt)) {
        return authState;
      }

      throw error;
    }
  }

  private async markReauthenticationRequired(authState: GitHubAppAuthState): Promise<void> {
    await this.authStateStore.save({
      ...authState,
      status: "reauth_required",
      accessToken: "",
      refreshToken: "",
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });
  }

  private requireGitHubAppClientId(): string {
    const clientId = SHARED_GITHUB_APP.clientId.trim();
    if (clientId.length === 0) {
      throw new Error("Shared GitHub App client ID is missing.");
    }
    return clientId;
  }

  private isRefreshNeeded(expiresAt: string | null): boolean {
    if (!expiresAt) {
      return false;
    }
    return Date.parse(expiresAt) - this.now() <= GitHubAuthManager.REFRESH_BUFFER_MS;
  }

  private isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) {
      return false;
    }
    return Date.parse(expiresAt) <= this.now();
  }

  private toFullName(owner?: string, repo?: string): string | null {
    const normalizedOwner = owner?.trim().toLowerCase() ?? "";
    const normalizedRepo = repo?.trim().toLowerCase() ?? "";
    if (!normalizedOwner || !normalizedRepo) {
      return null;
    }
    return `${normalizedOwner}/${normalizedRepo}`;
  }
}
