import { describe, expect, it } from "vitest";
import { PluginStateStore } from "../src/storage/state-store";
import type {
  ConflictRecord,
  SyncBaseline,
  SyncHealthState,
  SyncPreview,
} from "../src/types/sync-types";
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

describe("PluginStateStore", () => {
  it("persists baseline", async () => {
    const plugin = new FakePlugin();
    const store = new PluginStateStore(plugin as any);
    const baseline: SyncBaseline = { commitSha: "a", entries: { "a.md": { path: "a.md" } } };

    await store.saveBaseline(baseline);
    const loaded = await store.loadBaseline();

    expect(loaded).toEqual(baseline);
  });

  it("persists conflicts", async () => {
    const plugin = new FakePlugin();
    const store = new PluginStateStore(plugin as any);
    const conflicts: ConflictRecord[] = [
      {
        path: "a.md",
        type: "modify-modify",
        reason: "modify-modify",
        policy: "manual",
        timestamp: "now",
      },
    ];

    await store.saveConflicts(conflicts);
    const loaded = await store.loadConflicts();

    expect(loaded).toEqual(conflicts);
  });

  it("caps log length", async () => {
    const plugin = new FakePlugin();
    const store = new PluginStateStore(plugin as any);

    for (let i = 0; i < 600; i += 1) {
      await store.appendLog({ timestamp: String(i), level: "info", message: "m" });
    }

    const logs = await store.loadLogs();
    expect(logs).toHaveLength(500);
    expect(logs[0]?.timestamp).toBe("100");
  });

  it("preserves auth state when baseline changes", async () => {
    const plugin = new FakePlugin();
    const auth: GitHubAppAuthState = {
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
    };
    await plugin.saveData({ auth });

    const store = new PluginStateStore(plugin as any);
    await store.saveBaseline({ commitSha: "base", entries: {} });

    const saved = await plugin.loadData();
    expect(saved.auth).toEqual(auth);
  });

  it("redacts sensitive tokens from persisted logs", async () => {
    const plugin = new FakePlugin();
    const store = new PluginStateStore(plugin as any);

    await store.appendLog({
      timestamp: "now",
      level: "error",
      message:
        "authorization failed: access_token=ghu_verysecret refresh_token=ghr_evenmoresecret Bearer ghs_live",
    });

    const logs = await store.loadLogs();
    expect(logs[0]?.message).not.toContain("ghu_verysecret");
    expect(logs[0]?.message).not.toContain("ghr_evenmoresecret");
    expect(logs[0]?.message).not.toContain("ghs_live");
    expect(logs[0]?.message).toContain("[REDACTED]");
  });

  it("persists preview and health state alongside other plugin data", async () => {
    const plugin = new FakePlugin();
    await plugin.saveData({ auth: makeAuthState() });
    const store = new PluginStateStore(plugin as any);

    const preview: SyncPreview = {
      generatedAt: "2026-04-20T00:00:00.000Z",
      owner: "tim",
      repo: "repo",
      branch: "main",
      rootPath: "",
      repoScopeMode: "subfolder",
      repoSubfolder: "vault",
      summary: {
        localFileCount: 1,
        remoteFileCount: 1,
        baselineFileCount: 1,
        conflictCount: 0,
        counts: {
          pullNew: 0,
          pullUpdate: 0,
          pullDelete: 0,
          pushNew: 1,
          pushUpdate: 0,
          pushDelete: 0,
          renameLocal: 0,
          renameRemote: 0,
        },
      },
      diagnostics: [],
      ops: [{ type: "push_new", path: "note.md" }],
      conflicts: [],
      approval: {
        required: false,
        key: null,
        reason: null,
        pullDeleteCount: 0,
        deleteRatio: 0,
        thresholdRatio: 0.5,
      },
    };
    const health: SyncHealthState = {
      updatedAt: "2026-04-20T00:00:01.000Z",
      lastAction: "preview",
      lastResult: "preview",
      lastMessage: "Preview generated.",
      owner: "tim",
      repo: "repo",
      branch: "main",
      rootPath: "",
      repoScopeMode: "subfolder",
      repoSubfolder: "vault",
      baselineEntryCount: 1,
      previewApprovalRequired: false,
      previewApprovalKey: null,
      authStatus: "connected",
      diagnostics: [],
      rateLimit: null,
    };

    await store.savePreview(preview);
    await store.saveHealth(health);

    expect(await store.loadPreview()).toEqual(preview);
    expect(await store.loadHealth()).toEqual(health);
    const saved = await plugin.loadData();
    expect(saved.auth).toEqual(makeAuthState());
  });
});

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
