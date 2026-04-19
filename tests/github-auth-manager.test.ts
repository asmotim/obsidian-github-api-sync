import { describe, expect, it, vi } from "vitest";
import { GitHubAppOAuthError } from "../src/auth/github-app-device-flow";
import { GitHubAuthManager } from "../src/auth/github-auth-manager";
import { SHARED_GITHUB_APP } from "../src/config/shared-github-app";
import { DEFAULT_SETTINGS } from "../src/types/plugin-settings";
import type { GitHubAppAuthState } from "../src/types/auth-types";

class FakePlugin {
  settings = { ...DEFAULT_SETTINGS };
  private data: any = null;

  async loadData() {
    return this.data;
  }

  async saveData(data: any) {
    this.data = data;
  }
}

const makeAuthState = (): GitHubAppAuthState => ({
  provider: "githubApp",
  status: "connected",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  githubUserLogin: "tim",
  installationId: 1,
  installationAccountLogin: "tim",
  selectedOwner: "tim",
  selectedRepo: "repo",
});

describe("GitHubAuthManager", () => {
  it("returns the GitHub App session when connected auth state exists", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({ auth: makeAuthState() });

    const manager = new GitHubAuthManager(plugin as any);

    await expect(manager.ensureAuthenticatedSession()).resolves.toEqual({
      accessToken: "access-token",
    });
  });

  it("fails when no connected GitHub App auth state exists", async () => {
    const plugin = new FakePlugin();

    const manager = new GitHubAuthManager(plugin as any);

    await expect(manager.ensureAuthenticatedSession()).rejects.toThrow(
      "GitHub App authentication is not connected yet."
    );
  });

  it("refreshes an expiring GitHub App token before returning a session", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({
      auth: {
        ...makeAuthState(),
        accessToken: "old-token",
        refreshToken: "old-refresh",
        accessTokenExpiresAt: new Date(1_000).toISOString(),
      },
    });

    const deviceFlowClient = {
      refreshUserAccessToken: vi.fn().mockResolvedValue({
        accessToken: "new-token",
        refreshToken: "new-refresh",
        accessTokenExpiresAt: new Date(10_000).toISOString(),
        refreshTokenExpiresAt: new Date(20_000).toISOString(),
        tokenType: "bearer",
        scope: "",
      }),
    };

    const manager = new GitHubAuthManager(plugin as any, {
      deviceFlowClient: deviceFlowClient as any,
      now: () => 900,
    });

    await expect(manager.ensureAuthenticatedSession()).resolves.toEqual({
      accessToken: "new-token",
    });
    expect(deviceFlowClient.refreshUserAccessToken).toHaveBeenCalledWith(
      SHARED_GITHUB_APP.clientId,
      "old-refresh"
    );

    const saved = await plugin.loadData();
    expect(saved.auth.accessToken).toBe("new-token");
    expect(saved.auth.refreshToken).toBe("new-refresh");
    expect(saved.auth.status).toBe("connected");
  });

  it("marks GitHub App auth for reauthentication when refresh token is invalid", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({
      auth: {
        ...makeAuthState(),
        accessTokenExpiresAt: new Date(500).toISOString(),
      },
    });

    const deviceFlowClient = {
      refreshUserAccessToken: vi
        .fn()
        .mockRejectedValue(new GitHubAppOAuthError("bad_refresh_token", "refresh failed")),
    };

    const manager = new GitHubAuthManager(plugin as any, {
      deviceFlowClient: deviceFlowClient as any,
      now: () => 900,
    });

    await expect(manager.ensureAuthenticatedSession()).rejects.toThrow(
      "GitHub App authentication must be reconnected."
    );

    const saved = await plugin.loadData();
    expect(saved.auth.status).toBe("reauth_required");
    expect(saved.auth.accessToken).toBe("");
    expect(saved.auth.refreshToken).toBe("");
  });

  it("lists available repositories across installations without duplicates", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({ auth: makeAuthState() });

    const deviceFlowClient = {
      listInstallations: vi.fn().mockResolvedValue([
        { id: 1, accountLogin: "tim", repositorySelection: "selected" },
        { id: 2, accountLogin: "org", repositorySelection: "selected" },
      ]),
      listInstallationRepositories: vi
        .fn()
        .mockResolvedValueOnce([
          {
            installationId: 1,
            owner: "tim",
            repo: "notes",
            fullName: "tim/notes",
            private: true,
            accountLogin: "tim",
          },
        ])
        .mockResolvedValueOnce([
          {
            installationId: 2,
            owner: "org",
            repo: "vault",
            fullName: "org/vault",
            private: false,
            accountLogin: "org",
          },
          {
            installationId: 2,
            owner: "tim",
            repo: "notes",
            fullName: "tim/notes",
            private: true,
            accountLogin: "org",
          },
        ]),
    };

    const manager = new GitHubAuthManager(plugin as any, {
      deviceFlowClient: deviceFlowClient as any,
    });

    await expect(manager.listAvailableRepositories()).resolves.toEqual([
      {
        installationId: 2,
        owner: "org",
        repo: "vault",
        fullName: "org/vault",
        private: false,
        accountLogin: "org",
      },
      {
        installationId: 2,
        owner: "tim",
        repo: "notes",
        fullName: "tim/notes",
        private: true,
        accountLogin: "org",
      },
    ]);
  });

  it("remembers the selected repository in auth state", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({ auth: makeAuthState() });

    const manager = new GitHubAuthManager(plugin as any);
    await manager.rememberSelectedRepository({
      installationId: 2,
      owner: "org",
      repo: "vault",
      fullName: "org/vault",
      private: false,
      accountLogin: "org",
    });

    const saved = await plugin.loadData();
    expect(saved.auth.installationId).toBe(2);
    expect(saved.auth.installationAccountLogin).toBe("org");
    expect(saved.auth.selectedOwner).toBe("org");
    expect(saved.auth.selectedRepo).toBe("vault");
  });

  it("prefers the current repository selection when it is still available", async () => {
    const plugin = new FakePlugin();
    plugin.settings.owner = "org";
    plugin.settings.repo = "vault";
    await plugin.saveData({ auth: makeAuthState() });

    const manager = new GitHubAuthManager(plugin as any);
    await expect(
      manager.pickPreferredRepository(
        [
          {
            installationId: 2,
            owner: "org",
            repo: "vault",
            fullName: "org/vault",
            private: false,
            accountLogin: "org",
          },
          {
            installationId: 1,
            owner: "tim",
            repo: "repo",
            fullName: "tim/repo",
            private: true,
            accountLogin: "tim",
          },
        ],
        { owner: "org", repo: "vault" }
      )
    ).resolves.toEqual({
      installationId: 2,
      owner: "org",
      repo: "vault",
      fullName: "org/vault",
      private: false,
      accountLogin: "org",
    });
  });

  it("falls back to the remembered repository when the current one is missing", async () => {
    const plugin = new FakePlugin();
    plugin.settings.owner = "missing";
    plugin.settings.repo = "repo";
    await plugin.saveData({
      auth: {
        ...makeAuthState(),
        selectedOwner: "org",
        selectedRepo: "vault",
      },
    });

    const manager = new GitHubAuthManager(plugin as any);
    await expect(
      manager.pickPreferredRepository(
        [
          {
            installationId: 2,
            owner: "org",
            repo: "vault",
            fullName: "org/vault",
            private: false,
            accountLogin: "org",
          },
        ],
        { owner: "missing", repo: "repo" }
      )
    ).resolves.toEqual({
      installationId: 2,
      owner: "org",
      repo: "vault",
      fullName: "org/vault",
      private: false,
      accountLogin: "org",
    });
  });

  it("auto-selects the only available repository", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({ auth: makeAuthState() });

    const manager = new GitHubAuthManager(plugin as any);
    await expect(
      manager.pickPreferredRepository(
        [
          {
            installationId: 2,
            owner: "org",
            repo: "vault",
            fullName: "org/vault",
            private: false,
            accountLogin: "org",
          },
        ],
        { owner: "", repo: "" }
      )
    ).resolves.toEqual({
      installationId: 2,
      owner: "org",
      repo: "vault",
      fullName: "org/vault",
      private: false,
      accountLogin: "org",
    });
  });

  it("requires an explicit selection when multiple repositories are available", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({
      auth: {
        ...makeAuthState(),
        selectedOwner: "",
        selectedRepo: "",
      },
    });

    const manager = new GitHubAuthManager(plugin as any);
    await expect(
      manager.pickPreferredRepository(
        [
          {
            installationId: 2,
            owner: "org",
            repo: "vault",
            fullName: "org/vault",
            private: false,
            accountLogin: "org",
          },
          {
            installationId: 1,
            owner: "tim",
            repo: "repo",
            fullName: "tim/repo",
            private: true,
            accountLogin: "tim",
          },
        ],
        { owner: "", repo: "" }
      )
    ).resolves.toBeNull();
  });
});
