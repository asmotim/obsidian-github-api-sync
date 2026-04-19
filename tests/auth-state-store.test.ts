import { describe, expect, it } from "vitest";
import { GitHubAppAuthStateStore } from "../src/storage/auth-state-store";
import type { GitHubAppAuthState } from "../src/types/auth-types";

class FakePlugin {
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

describe("GitHubAppAuthStateStore", () => {
  it("persists auth state without dropping unrelated plugin data", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({
      baseline: { commitSha: "base", entries: {} },
      owner: "tim",
    });

    const store = new GitHubAppAuthStateStore(plugin as any);
    const authState = makeAuthState();
    await store.save(authState);

    expect(await store.load()).toEqual(authState);
    const raw = await plugin.loadData();
    expect(raw.baseline).toEqual({ commitSha: "base", entries: {} });
    expect(raw.owner).toBe("tim");
  });

  it("clears auth state", async () => {
    const plugin = new FakePlugin();
    const store = new GitHubAppAuthStateStore(plugin as any);
    await store.save(makeAuthState());

    await store.clear();

    expect(await store.load()).toBeNull();
  });
});
