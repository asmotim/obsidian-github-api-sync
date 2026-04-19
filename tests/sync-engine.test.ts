import { describe, expect, it, vi } from "vitest";
import { DefaultSyncEngine } from "../src/core/sync-engine";
import { DefaultConflictResolver } from "../src/core/conflict-resolver";
import type { RemoteIndex, SyncBaseline, SyncConfig, SyncOp } from "../src/types/sync-types";
import { FakeApp, FakeVault } from "./helpers/fake-obsidian";

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

describe("DefaultSyncEngine", () => {
  it("executes ops in expected order", async () => {
    const vault = new FakeVault();
    await vault.createBinary("old.md", new Uint8Array([1]));
    await vault.createBinary("renamed_new.md", new Uint8Array([2]));
    await vault.createBinary("local_new.md", new Uint8Array([3]));
    const app = new FakeApp(vault);

    const logs: string[] = [];
    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue(null),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(async (entry: { message: string }) => {
        logs.push(entry.message);
      }),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue({}),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndex: RemoteIndex = {
      "local_deleted.md": { path: "local_deleted.md", sha: "s1", size: 1, lastCommitTime: 0 },
      "renamed_old.md": { path: "renamed_old.md", sha: "s2", size: 1, lastCommitTime: 0 },
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue(remoteIndex),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({
        ops: [
          { type: "rename_remote", from: "old.md", to: "new.md" },
          { type: "pull_delete", path: "gone.md" },
          { type: "pull_new", path: "remote.md" },
          { type: "rename_local", from: "renamed_old.md", to: "renamed_new.md" },
          { type: "push_delete", path: "local_deleted.md" },
          { type: "push_new", path: "local_new.md" },
        ] as SyncOp[],
        conflicts: [],
      }),
    };

    const resolver = {
      resolve: vi.fn().mockReturnValue({ resolvedOps: [], conflictRecords: [] }),
    };

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "h", date: "" }),
      getCommitTreeSha: vi.fn().mockResolvedValue("tree"),
      createBlob: vi.fn().mockResolvedValue("blob"),
      createTree: vi.fn().mockResolvedValue("tree-new"),
      createCommit: vi.fn().mockResolvedValue("commit-new"),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      resolver as any,
      stateStore as any
    );

    await engine.sync(makeConfig());

    const opLogs = logs.filter((entry) => entry.startsWith("Op ok:"));
    expect(opLogs).toEqual([
      "Op ok: rename_local old.md -> new.md",
      "Op ok: pull_delete gone.md",
      "Op ok: pull_new remote.md",
      "Op ok: batch_push 2 updates, 2 deletes",
    ]);
  });

  it("updates baseline with commit sha", async () => {
    const vault = new FakeVault();
    const app = new FakeApp(vault);

    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue(null),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue({}),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue({}),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({ ops: [], conflicts: [] }),
    };

    const resolver = new DefaultConflictResolver();

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "head", date: "" }),
      getCommitTreeSha: vi.fn().mockResolvedValue("tree"),
      createBlob: vi.fn().mockResolvedValue("blob"),
      createTree: vi.fn().mockResolvedValue("tree-new"),
      createCommit: vi.fn().mockResolvedValue("commit-new"),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn(),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      resolver as any,
      stateStore as any
    );

    await engine.sync(makeConfig());

    expect(stateStore.saveBaseline).toHaveBeenCalled();
    const baseline = stateStore.saveBaseline.mock.calls[0][0] as SyncBaseline;
    expect(baseline.commitSha).toBe("head");
  });

  it("logs and throws when an op fails", async () => {
    const vault = new FakeVault();
    await vault.createBinary("local_new.md", new Uint8Array([1]));
    const app = new FakeApp(vault);

    const logs: string[] = [];
    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue(null),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(async (entry: { message: string }) => {
        logs.push(entry.message);
      }),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue({}),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue({}),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({
        ops: [{ type: "push_new", path: "local_new.md" } as SyncOp],
        conflicts: [],
      }),
    };

    const resolver = new DefaultConflictResolver();

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "h", date: "" }),
      getCommitTreeSha: vi.fn().mockResolvedValue("tree"),
      createBlob: vi.fn().mockRejectedValue(new Error("boom")),
      createTree: vi.fn(),
      createCommit: vi.fn(),
      updateRef: vi.fn(),
      getFile: vi.fn(),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      resolver as any,
      stateStore as any
    );

    await expect(engine.sync(makeConfig())).rejects.toThrow("Sync failed with 1 errors.");
    expect(logs.some((entry) => entry.includes("Op failed"))).toBe(true);
  });

  it("creates keepBoth conflict copies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const vault = new FakeVault();
    const app = new FakeApp(vault);

    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue(null),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue({}),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue({}),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({
        ops: [],
        conflicts: [{ type: "conflict", path: "note.md", reason: "modify-modify" }],
      }),
    };

    const resolver = new DefaultConflictResolver();

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "h", date: "" }),
      getCommitTreeSha: vi.fn().mockResolvedValue("tree"),
      createBlob: vi.fn().mockResolvedValue("blob"),
      createTree: vi.fn().mockResolvedValue("tree-new"),
      createCommit: vi.fn().mockResolvedValue("commit-new"),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      resolver as any,
      stateStore as any
    );

    await engine.sync({ ...makeConfig(), conflictPolicy: "keepBoth" });

    const entries = Array.from(vault.files.keys());
    const hasConflictCopy = entries.some(
      (path) => path.startsWith("note (conflict-remote-") && path.endsWith(").md")
    );
    expect(hasConflictCopy).toBe(true);
    vi.useRealTimers();
  });

  it("writes remote changes under configured repository subfolder", async () => {
    const vault = new FakeVault();
    await vault.createBinary("note.md", new Uint8Array([1]));
    const app = new FakeApp(vault);

    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue(null),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue({ "note.md": { path: "note.md", hash: "h1", mtime: 1, size: 1 } }),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue({}),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({
        ops: [{ type: "push_new", path: "note.md" }],
        conflicts: [],
      }),
    };

    const resolver = new DefaultConflictResolver();

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "head", date: "" }),
      getCommitTreeSha: vi.fn().mockResolvedValue("tree"),
      createBlob: vi.fn().mockResolvedValue("blob"),
      createTree: vi.fn().mockResolvedValue("tree-new"),
      createCommit: vi.fn().mockResolvedValue("commit-new"),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn(),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      resolver as any,
      stateStore as any
    );

    await engine.sync({
      ...makeConfig(),
      repoScopeMode: "subfolder",
      repoSubfolder: "vault",
    });

    const entries = gitClient.createTree.mock.calls[0][0].entries;
    expect(entries[0].path).toBe("vault/note.md");
  });
});
