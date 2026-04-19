import { describe, expect, it, vi } from "vitest";
import { DefaultSyncEngine } from "../src/core/sync-engine";
import { DefaultConflictResolver } from "../src/core/conflict-resolver";
import { DefaultSyncPlanner } from "../src/core/sync-planner";
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

  it("removes orphaned gitkeep placeholders and empty folders after local deletes", async () => {
    const vault = new FakeVault();
    await vault.createBinary("02 Projects/note.md", new Uint8Array([1]));
    await vault.createBinary("02 Projects/.gitkeep", new Uint8Array([2]));
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
        ops: [{ type: "pull_delete", path: "02 Projects/note.md" } as SyncOp],
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

    await engine.sync(makeConfig());

    expect(vault.getAbstractFileByPath("02 Projects/note.md")).toBeNull();
    expect(vault.getAbstractFileByPath("02 Projects/.gitkeep")).toBeNull();
    expect(vault.getAbstractFileByPath("02 Projects")).toBeNull();
  });

  it("keeps the configured local sync root while removing orphaned placeholders inside it", async () => {
    const vault = new FakeVault();
    await vault.createBinary("Journal/note.md", new Uint8Array([1]));
    await vault.createBinary("Journal/.gitkeep", new Uint8Array([2]));
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
        ops: [{ type: "pull_delete", path: "Journal/note.md" } as SyncOp],
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
      rootPath: "Journal",
    });

    expect(vault.getAbstractFileByPath("Journal/.gitkeep")).toBeNull();
    expect(vault.getAbstractFileByPath("Journal")).not.toBeNull();
  });

  it("preserves and restores empty folders that still exist remotely via .gitkeep placeholders", async () => {
    const vault = new FakeVault();
    await vault.createBinary("10 Archive/.gitkeep", new Uint8Array([1]));
    const app = new FakeApp(vault);

    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue({
        commitSha: "base",
        entries: {},
        placeholderDirectories: ["10 Archive"],
      }),
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
      getLastFetchMeta: vi.fn().mockReturnValue({
        mode: "incremental",
        diagnostics: [],
        usedFullFallback: false,
        usedTruncatedTreeFallback: false,
        placeholderDirectories: ["09 Attachments/PDFs", "10 Archive"],
      }),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({
        ops: [],
        conflicts: [],
      }),
    };

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "head", date: "" }),
      getCommitTreeSha: vi.fn().mockResolvedValue("tree"),
      createBlob: vi.fn().mockResolvedValue("blob"),
      createTree: vi.fn().mockResolvedValue("tree-new"),
      createCommit: vi.fn().mockResolvedValue("commit-new"),
      updateRef: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn(),
      getLastRateLimitSnapshot: vi.fn().mockReturnValue(null),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      new DefaultConflictResolver(),
      stateStore as any
    );

    await engine.sync(makeConfig());

    expect(vault.getAbstractFileByPath("10 Archive")).not.toBeNull();
    expect(vault.getAbstractFileByPath("10 Archive/.gitkeep")).toBeNull();
    expect(vault.getAbstractFileByPath("09 Attachments")).not.toBeNull();
    expect(vault.getAbstractFileByPath("09 Attachments/PDFs")).not.toBeNull();
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

  it("ignores hidden and ignored remote paths when planning pulls", async () => {
    const vault = new FakeVault();
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
      fetchIndex: vi.fn().mockResolvedValue({
        ".obsidian/README.md": {
          path: ".obsidian/README.md",
          sha: "s1",
          size: 1,
          lastCommitTime: 0,
        },
        "00 Inbox/.gitkeep": {
          path: "00 Inbox/.gitkeep",
          sha: "s2",
          size: 1,
          lastCommitTime: 0,
        },
        "remote.md": {
          path: "remote.md",
          sha: "s3",
          size: 1,
          lastCommitTime: 0,
        },
      }),
    };

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "head", date: "" }),
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
      new DefaultSyncPlanner(),
      new DefaultConflictResolver(),
      stateStore as any
    );

    await engine.sync({
      ...makeConfig(),
      ignorePatterns: [".obsidian/"],
      conflictPolicy: "manual",
    });

    expect(vault.getAbstractFileByPath("remote.md")).not.toBeNull();
    expect(vault.getAbstractFileByPath(".obsidian/README.md")).toBeNull();
    expect(vault.getAbstractFileByPath("00 Inbox/.gitkeep")).toBeNull();
    expect(
      logs.some((entry) =>
        entry.includes("Plan summary: 0 local, 1 remote, 0 baseline, 0 conflicts.")
      )
    ).toBe(true);
  });

  it("stores an approval-requiring preview and blocks destructive syncs until approved", async () => {
    const vault = new FakeVault();
    const app = new FakeApp(vault);
    const deleteOps = Array.from({ length: 10 }, (_, index) => ({
      type: "pull_delete" as const,
      path: `note-${index}.md`,
    }));

    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue({
        commitSha: "base",
        entries: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`note-${index}.md`, { path: `note-${index}.md` }])
        ),
      }),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(),
      savePreview: vi.fn(),
      saveHealth: vi.fn(),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue(
        Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [
            `note-${index}.md`,
            { path: `note-${index}.md`, hash: `hash-${index}`, mtime: index + 1, size: 1 },
          ])
        )
      ),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue({}),
    };

    const planner = {
      plan: vi.fn().mockReturnValue({
        ops: deleteOps,
        conflicts: [],
      }),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      { getLastRateLimitSnapshot: vi.fn().mockReturnValue(null) } as any,
      localIndexer as any,
      remoteIndexer as any,
      planner as any,
      new DefaultConflictResolver(),
      stateStore as any
    );

    await expect(engine.sync(makeConfig())).rejects.toThrow("Sync blocked:");

    const preview = stateStore.savePreview.mock.calls[0]?.[0];
    expect(preview?.approval.required).toBe(true);
    expect(preview?.approval.key).toMatch(/^approve-/);
    expect(stateStore.saveHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        lastResult: "blocked",
        previewApprovalRequired: true,
      })
    );
  });

  it("repairs the baseline from current local and remote state and clears stored preview", async () => {
    const vault = new FakeVault();
    const app = new FakeApp(vault);

    const stateStore = {
      loadBaseline: vi.fn().mockResolvedValue({ commitSha: "old", entries: {} }),
      saveBaseline: vi.fn(),
      saveConflicts: vi.fn(),
      appendLog: vi.fn(),
      savePreview: vi.fn(),
      saveHealth: vi.fn(),
    };

    const localIndexer = {
      scan: vi.fn().mockResolvedValue({
        "local.md": { path: "local.md", hash: "hash-local", mtime: 1, size: 1 },
      }),
      setPreviousBaseline: vi.fn(),
      setMaxFileSizeMB: vi.fn(),
    };

    const remoteIndexer = {
      fetchIndex: vi.fn().mockResolvedValue({
        "remote.md": { path: "remote.md", sha: "sha-remote", size: 2, lastCommitTime: 2 },
      }),
      getLastFetchMeta: vi.fn().mockReturnValue({
        mode: "full",
        diagnostics: [],
        usedFullFallback: false,
        usedTruncatedTreeFallback: false,
      }),
    };

    const gitClient = {
      getCommitInfo: vi.fn().mockResolvedValue({ sha: "head", date: "" }),
      getLastRateLimitSnapshot: vi.fn().mockReturnValue(null),
    };

    const engine = new DefaultSyncEngine(
      app as any,
      gitClient as any,
      localIndexer as any,
      remoteIndexer as any,
      new DefaultSyncPlanner(),
      new DefaultConflictResolver(),
      stateStore as any
    );

    const baseline = await engine.repairBaseline(makeConfig());

    expect(baseline.commitSha).toBe("head");
    expect(baseline.entries["local.md"]?.hash).toBe("hash-local");
    expect(baseline.entries["remote.md"]?.sha).toBe("sha-remote");
    expect(stateStore.savePreview).toHaveBeenCalledWith(null);
    expect(stateStore.saveHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        lastAction: "repair-baseline",
        lastResult: "repaired",
      })
    );
  });
});
