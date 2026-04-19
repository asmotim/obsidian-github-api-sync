import { describe, expect, it, vi } from "vitest";
import { DefaultSyncEngine } from "../src/core/sync-engine";
import { DefaultSyncPlanner } from "../src/core/sync-planner";
import { DefaultConflictResolver } from "../src/core/conflict-resolver";
import { LocalVaultIndexer } from "../src/indexers/local-indexer";
import { GitHubRemoteIndexer } from "../src/indexers/remote-indexer";
import { PluginStateStore } from "../src/storage/state-store";
import type { SyncConfig } from "../src/types/sync-types";
import { FakeApp, FakeVault } from "./helpers/fake-obsidian";

class FakePlugin {
  private data: any = null;
  async loadData() {
    return this.data;
  }
  async saveData(data: any) {
    this.data = data;
  }
}

class FakeGitHubClient {
  private files = new Map<string, { content: string; sha: string }>();
  private shaCounter = 1;
  private changed = new Set<string>();
  private trees = new Map<string, Array<{ path: string; sha: string | null }>>();
  private blobs = new Map<string, { content: string; sha: string }>();

  seed(path: string, content: string, sha = `sha-${this.shaCounter++}`) {
    this.files.set(path, { content, sha });
  }

  markChanged(path: string) {
    this.changed.add(path);
  }

  async getFile(path: string, _ref: string) {
    const entry = this.files.get(path);
    if (!entry) {
      throw new Error("not found");
    }
    return { content: entry.content, sha: entry.sha };
  }

  async putFile(path: string, contentBase64: string) {
    this.files.set(path, { content: contentBase64, sha: `sha-${this.shaCounter++}` });
    this.changed.add(path);
  }

  async deleteFile(path: string) {
    this.files.delete(path);
    this.changed.add(path);
  }

  async listTree(_ref: string) {
    const index: Record<string, { path: string; sha: string; size: number; lastCommitTime: number }> = {};
    for (const [path, entry] of this.files.entries()) {
      index[path] = {
        path,
        sha: entry.sha,
        size: Buffer.from(entry.content, "base64").length,
        lastCommitTime: 0,
      };
    }
    return {
      index,
      truncated: false,
      usedTruncatedTreeFallback: false,
    };
  }

  async getCommitInfo(_branch: string) {
    return { sha: "head", date: "" };
  }

  async getCommitTreeSha(_commitSha: string) {
    return "tree-base";
  }

  async createBlob(contentBase64: string) {
    const sha = `blob-${this.shaCounter++}`;
    this.blobs.set(sha, { content: contentBase64, sha });
    return sha;
  }

  async createTree(options: {
    baseTreeSha?: string;
    entries: Array<{ path: string; sha: string | null; mode: string; type: "blob" }>;
  }) {
    const treeSha = `tree-${this.shaCounter++}`;
    this.trees.set(treeSha, options.entries.map((entry) => ({ path: entry.path, sha: entry.sha })));

    for (const entry of options.entries) {
      if (entry.sha === null) {
        this.files.delete(entry.path);
      } else {
        const blob = this.blobs.get(entry.sha);
        if (blob) {
          this.files.set(entry.path, { content: blob.content, sha: entry.sha });
        }
      }
      this.changed.add(entry.path);
    }

    return treeSha;
  }

  async createCommit(_message: string, treeSha: string) {
    return `commit-${treeSha}`;
  }

  async updateRef(_branch: string, _commitSha: string) {
    this.changed.clear();
  }

  async compareCommits() {
    const files = Array.from(this.changed).map((path) => ({
      filename: path,
      status: this.files.has(path) ? "modified" : "removed",
    }));
    return {
      files,
      headCommitDate: new Date().toISOString(),
      totalCommits: files.length,
      hasPagination: false,
      fileListMayBeIncomplete: false,
    };
  }

  async getRepoInfo() {
    return { private: false, permissions: { push: true, pull: true } };
  }

  getLastRateLimitSnapshot() {
    return null;
  }
}

const makeConfig = (): SyncConfig => ({
  token: "t",
  owner: "o",
  repo: "r",
  branch: "main",
  rootPath: "",
  repoScopeMode: "fullRepo",
  repoSubfolder: "vault",
  ignorePatterns: [],
  conflictPolicy: "preferLocal",
});

describe("integration sync", () => {
  it("pulls remote new file and pushes local new file", async () => {
    const vault = new FakeVault();
    await vault.createBinary("local.md", new Uint8Array([1]));
    const app = new FakeApp(vault);

    const client = new FakeGitHubClient();
    client.seed("remote.md", Buffer.from("remote").toString("base64"));

    const plugin = new FakePlugin();
    const stateStore = new PluginStateStore(plugin as any);
    const localIndexer = new LocalVaultIndexer(app as any);
    const remoteIndexer = new GitHubRemoteIndexer(client as any);
    const planner = new DefaultSyncPlanner();
    const resolver = new DefaultConflictResolver();

    const engine = new DefaultSyncEngine(
      app as any,
      client as any,
      localIndexer,
      remoteIndexer,
      planner,
      resolver,
      stateStore
    );

    const commitSpy = vi.spyOn(client, "createCommit");

    await engine.sync(makeConfig());

    expect(vault.getAbstractFileByPath("remote.md")).not.toBeNull();
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(await stateStore.loadBaseline()).not.toBeNull();
  });

  it("is idempotent when no changes", async () => {
    const vault = new FakeVault();
    await vault.createBinary("local.md", new Uint8Array([1]));
    const app = new FakeApp(vault);

    const client = new FakeGitHubClient();
    client.seed("local.md", Buffer.from("local").toString("base64"));

    const plugin = new FakePlugin();
    const stateStore = new PluginStateStore(plugin as any);
    const localIndexer = new LocalVaultIndexer(app as any);
    const remoteIndexer = new GitHubRemoteIndexer(client as any);
    const planner = new DefaultSyncPlanner();
    const resolver = new DefaultConflictResolver();

    const engine = new DefaultSyncEngine(
      app as any,
      client as any,
      localIndexer,
      remoteIndexer,
      planner,
      resolver,
      stateStore
    );

    const commitSpy = vi.spyOn(client, "createCommit");

    await engine.sync(makeConfig());
    await engine.sync(makeConfig());

    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-conflict after manual resolution", async () => {
    const vault = new FakeVault();
    await vault.createBinary("note.md", new Uint8Array([1]));
    const app = new FakeApp(vault);

    const client = new FakeGitHubClient();
    client.seed("note.md", Buffer.from("base").toString("base64"));

    const plugin = new FakePlugin();
    const stateStore = new PluginStateStore(plugin as any);
    const localIndexer = new LocalVaultIndexer(app as any);
    const remoteIndexer = new GitHubRemoteIndexer(client as any);
    const planner = new DefaultSyncPlanner();
    const resolver = new DefaultConflictResolver();

    const engine = new DefaultSyncEngine(
      app as any,
      client as any,
      localIndexer,
      remoteIndexer,
      planner,
      resolver,
      stateStore
    );

    const baseConfig = makeConfig();
    await engine.sync(baseConfig);

    await vault.createBinary("note.md", new Uint8Array([2]));
    client.seed("note.md", Buffer.from("remote").toString("base64"));
    client.markChanged("note.md");

    await engine.sync({ ...baseConfig, conflictPolicy: "manual" });
    const conflicts = await stateStore.loadConflicts();
    expect(conflicts.length).toBe(1);

    const { ConflictActionRunner } = await import("../src/core/conflict-action-runner");
    const runner = new ConflictActionRunner(app as any, client as any);
    const firstConflict = conflicts[0];
    if (!firstConflict) {
      throw new Error("Expected a conflict to be present");
    }
    await runner.resolve(firstConflict, "keepLocal", baseConfig);

    await stateStore.saveConflicts([]);

    await engine.sync(baseConfig);
    const finalConflicts = await stateStore.loadConflicts();
    expect(finalConflicts.length).toBe(0);
  });
});
