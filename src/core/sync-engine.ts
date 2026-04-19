import { normalizePath, type App, TFile } from "obsidian";
import type {
  LocalIndex,
  RemoteIndex,
  SyncBaseline,
  SyncConfig,
  SyncOp,
  SyncProgress,
} from "../types/sync-types";
import type {
  ConflictResolver,
  GitHubClient,
  LocalIndexer,
  RemoteIndexer,
  StateStore,
  SyncEngine,
  SyncPlanner,
} from "../types/interfaces";

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export class DefaultSyncEngine implements SyncEngine {
  private app: App;
  private gitClient: GitHubClient;
  private localIndexer: LocalIndexer;
  private remoteIndexer: RemoteIndexer;
  private planner: SyncPlanner;
  private resolver: ConflictResolver;
  private stateStore: StateStore;

  constructor(
    app: App,
    gitClient: GitHubClient,
    localIndexer: LocalIndexer,
    remoteIndexer: RemoteIndexer,
    planner: SyncPlanner,
    resolver: ConflictResolver,
    stateStore: StateStore
  ) {
    this.app = app;
    this.gitClient = gitClient;
    this.localIndexer = localIndexer;
    this.remoteIndexer = remoteIndexer;
    this.planner = planner;
    this.resolver = resolver;
    this.stateStore = stateStore;
  }

  async sync(config: SyncConfig): Promise<void> {
    await this.log("info", "Sync started.");
    try {
      // Stage 1: Scanning
      this.reportProgress(config, {
        stage: "scanning",
        message: "Loading baseline and scanning files...",
      });

      const baseline = await this.stateStore.loadBaseline();

      // Pass baseline to local indexer for hash optimization
      this.localIndexer.setPreviousBaseline(baseline);

      // Set max file size limit
      if (config.maxFileSizeMB) {
        this.localIndexer.setMaxFileSizeMB(config.maxFileSizeMB);
      }

      const [local, remote] = await Promise.all([
        this.localIndexer.scan(config.rootPath, config.ignorePatterns),
        this.remoteIndexer.fetchIndex(config.owner, config.repo, config.branch, baseline),
      ]);

      // Stage 2: Planning
      this.reportProgress(config, {
        stage: "planning",
        message: "Planning sync operations...",
      });

      const { ops, conflicts } = this.planner.plan(local, remote, baseline);

      // Log detailed plan information for debugging
      await this.log(
        "info",
        `Scan results: ${Object.keys(local).length} local files, ${Object.keys(remote).length} remote files, ` +
        `${baseline ? Object.keys(baseline.entries).length : 0} baseline entries.`
      );
      await this.log(
        "info",
        `Planned ${ops.length} ops with ${conflicts.length} conflicts.`
      );

      // Log operation breakdown
      const opsByType = ops.reduce((acc, op) => {
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [type, count] of Object.entries(opsByType)) {
        await this.log("info", `  ${type}: ${count}`);
      }

      // Log specific operations for debugging
      for (const op of ops) {
        if (op.type === "pull_new" || op.type === "pull_update") {
          await this.log("info", `  → ${op.type}: ${op.path}`);
        } else if (op.type === "push_new" || op.type === "push_update") {
          await this.log("info", `  → ${op.type}: ${op.path}`);
        } else if (op.type === "rename_local" || op.type === "rename_remote") {
          await this.log("info", `  → ${op.type}: ${op.from} -> ${op.to}`);
        }
      }
      const { resolvedOps, conflictRecords } = this.resolver.resolve(
        conflicts,
        config.conflictPolicy
      );

      const finalOps: SyncOp[] = [
        ...ops.filter((op): op is Exclude<SyncOp, { type: "conflict" }> => op.type !== "conflict"),
        ...resolvedOps,
      ];

      await this.stateStore.saveConflicts(conflictRecords);

      // Stage 3: Executing
      this.reportProgress(config, {
        stage: "executing",
        message: `Executing ${finalOps.length} operations...`,
        total: finalOps.length,
      });

      await this.executeOps(finalOps, conflicts, config, local, remote);

      // Stage 4: Saving baseline
      this.reportProgress(config, {
        stage: "saving",
        message: "Saving sync state...",
      });

      // After operations, get fresh remote state and rescan local (with cache optimization)
      const newCommitSha = await this.gitClient.getCommitInfo(config.branch).then((info) => info.sha);

      // Fetch fresh remote index to get new SHAs after push operations
      // Use null baseline to force full fetch (since remote state changed)
      const updatedRemote = await this.remoteIndexer.fetchIndex(
        config.owner,
        config.repo,
        config.branch,
        null
      );

      // Rescan local with baseline optimization (reuses hashes for unchanged files)
      const updatedLocal = await this.localIndexer.scan(config.rootPath, config.ignorePatterns);

      // Build baseline from updated state
      const baselineSnapshot = this.buildBaseline(updatedLocal, updatedRemote, newCommitSha);
      await this.stateStore.saveBaseline(baselineSnapshot);
      await this.log("info", "Sync completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.log("error", `Sync failed: ${message}`);
      throw error;
    }
  }

  private async executeOps(
    ops: SyncOp[],
    conflicts: SyncOp[],
    config: SyncConfig,
    _local: LocalIndex,
    _remote: RemoteIndex
  ): Promise<void> {
    const failures: string[] = [];
    const renameRemote = ops.filter((op) => op.type === "rename_remote") as Array<{
      type: "rename_remote";
      from: string;
      to: string;
    }>;
    const pullDelete = ops.filter((op) => op.type === "pull_delete") as Array<{
      type: "pull_delete";
      path: string;
    }>;
    const pullUpdates = ops.filter(
      (op) => op.type === "pull_update" || op.type === "pull_new"
    ) as Array<{ type: "pull_update" | "pull_new"; path: string }>;
    const renameLocal = ops.filter((op) => op.type === "rename_local") as Array<{
      type: "rename_local";
      from: string;
      to: string;
    }>;
    const pushDelete = ops.filter((op) => op.type === "push_delete") as Array<{
      type: "push_delete";
      path: string;
    }>;
    const pushUpdates = ops.filter(
      (op) => op.type === "push_update" || op.type === "push_new"
    ) as Array<{ type: "push_update" | "push_new"; path: string }>;

    for (const op of renameRemote) {
      await this.runOp(`rename_local ${op.from} -> ${op.to}`, failures, () =>
        this.renameLocalFile(op.from, op.to)
      );
    }

    for (const op of pullDelete) {
      await this.runOp(`pull_delete ${op.path}`, failures, () =>
        this.deleteLocalFile(op.path)
      );
    }

    for (const op of pullUpdates) {
      await this.runOp(`${op.type} ${op.path}`, failures, () =>
        this.pullRemoteFile(op.path, config.branch)
      );
    }

    const batchDeletes = new Set<string>();
    const batchUpdates = new Set<string>();
    for (const op of pushDelete) {
      batchDeletes.add(op.path);
    }
    for (const op of pushUpdates) {
      batchUpdates.add(op.path);
    }
    for (const op of renameLocal) {
      batchDeletes.add(op.from);
      batchUpdates.add(op.to);
    }

    for (const path of batchUpdates) {
      batchDeletes.delete(path);
    }

    if (batchDeletes.size > 0 || batchUpdates.size > 0) {
      await this.runOp(
        `batch_push ${batchUpdates.size} updates, ${batchDeletes.size} deletes`,
        failures,
        () => this.batchPush(batchUpdates, batchDeletes, config)
      );
    }

    if (config.conflictPolicy === "keepBoth") {
      await this.runOp("keepBoth_conflicts", failures, () =>
        this.applyKeepBothConflicts(conflicts, config)
      );
    }

    if (failures.length > 0) {
      throw new Error(`Sync failed with ${failures.length} errors.`);
    }
  }

  private async renameLocalFile(fromPath: string, toPath: string): Promise<void> {
    const from = normalizePath(fromPath);
    const to = normalizePath(toPath);
    const abstractFile = this.app.vault.getAbstractFileByPath(from);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    await this.ensureParentFolder(to);
    await this.app.vault.rename(abstractFile, to);
  }

  private async deleteLocalFile(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    await this.app.fileManager.trashFile(abstractFile);
  }

  private async pullRemoteFile(path: string, branch: string): Promise<void> {
    const normalized = normalizePath(path);
    const { content } = await this.gitClient.getFile(normalized, branch);
    const buffer = Buffer.from(content, "base64");
    await this.ensureParentFolder(normalized);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing && existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, toArrayBuffer(buffer));
      return;
    }

    await this.app.vault.createBinary(normalized, toArrayBuffer(buffer));
  }

  private async pullRemoteCopy(path: string, targetPath: string, branch: string): Promise<void> {
    const normalized = normalizePath(path);
    const { content } = await this.gitClient.getFile(normalized, branch);
    const buffer = Buffer.from(content, "base64");
    await this.ensureParentFolder(targetPath);
    await this.app.vault.createBinary(targetPath, toArrayBuffer(buffer));
  }

  private async renameRemoteFile(
    fromPath: string,
    toPath: string,
    remote: RemoteIndex,
    config: SyncConfig
  ): Promise<void> {
    await this.pushLocalFile(toPath, remote, config);
    const remoteEntry = remote[fromPath];
    if (remoteEntry?.sha) {
      await this.gitClient.deleteFile(
        fromPath,
        `sync: delete ${fromPath}`,
        remoteEntry.sha,
        config.branch
      );
    }
  }

  private async deleteRemoteFile(
    path: string,
    remote: RemoteIndex,
    config: SyncConfig
  ): Promise<void> {
    const remoteEntry = remote[path];
    if (!remoteEntry?.sha) {
      return;
    }

    await this.gitClient.deleteFile(path, `sync: delete ${path}`, remoteEntry.sha, config.branch);
  }

  private async pushLocalFile(
    path: string,
    remote: RemoteIndex,
    config: SyncConfig
  ): Promise<void> {
    const normalized = normalizePath(path);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    const data = await this.app.vault.readBinary(abstractFile);
    const contentBase64 = Buffer.from(data).toString("base64");
    const remoteEntry = remote[path];
    await this.gitClient.putFile(
      normalized,
      contentBase64,
      `sync: update ${path}`,
      remoteEntry?.sha,
      config.branch
    );
  }

  private async batchPush(
    updates: Set<string>,
    deletes: Set<string>,
    config: SyncConfig
  ): Promise<void> {
    const headInfo = await this.gitClient.getCommitInfo(config.branch);
    const parentSha = headInfo.sha;
    const baseTreeSha = parentSha ? await this.gitClient.getCommitTreeSha(parentSha) : undefined;

    const entries: Array<{ path: string; sha: string | null; mode: string; type: "blob" }> = [];

    for (const path of updates) {
      const normalized = normalizePath(path);
      const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
      if (!abstractFile || !(abstractFile instanceof TFile)) {
        console.warn(`batchPush: File not found for update: ${normalized}`);
        continue;
      }
      try {
        const data = await this.app.vault.readBinary(abstractFile);
        const contentBase64 = Buffer.from(data).toString("base64");
        const blobSha = await this.gitClient.createBlob(contentBase64);
        entries.push({ path: normalized, sha: blobSha, mode: "100644", type: "blob" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`batchPush: Failed to process file ${normalized}: ${message}`);
        throw new Error(`Failed to process file ${normalized}: ${message}`);
      }
    }

    for (const path of deletes) {
      entries.push({ path: normalizePath(path), sha: null, mode: "100644", type: "blob" });
    }

    if (entries.length === 0) {
      return;
    }

    const treeSha = await this.gitClient.createTree({
      baseTreeSha,
      entries,
    });
    const commitMessage = `sync: batch ${updates.size} updates, ${deletes.size} deletes`;
    const newCommitSha = await this.gitClient.createCommit(
      commitMessage,
      treeSha,
      parentSha ? [parentSha] : []
    );
    await this.gitClient.updateRef(config.branch, newCommitSha);
  }

  private async copyLocalFile(sourcePath: string, targetPath: string): Promise<void> {
    const normalized = normalizePath(sourcePath);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    const data = await this.app.vault.readBinary(abstractFile);
    await this.ensureParentFolder(targetPath);
    await this.app.vault.createBinary(targetPath, data);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (!parent) {
      return;
    }

    const existing = this.app.vault.getAbstractFileByPath(parent);
    if (existing) {
      return;
    }

    const segments = parent.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async applyKeepBothConflicts(conflicts: SyncOp[], config: SyncConfig): Promise<void> {
    for (const conflict of conflicts) {
      if (conflict.type !== "conflict") {
        continue;
      }

      const reason = conflict.reason;
      const tag =
        reason === "delete-modify-local"
          ? "conflict-local"
          : "conflict-remote";
      const conflictPath = this.nextConflictPath(conflict.path, tag);

      if (reason === "modify-modify") {
        await this.pullRemoteCopy(conflict.path, conflictPath, config.branch);
        await this.log(
          "warn",
          `Conflict keepBoth: remote copy saved as ${conflictPath}`
        );
        continue;
      }

      if (reason === "delete-modify-local") {
        await this.pullRemoteCopy(conflict.path, conflictPath, config.branch);
        await this.log(
          "warn",
          `Conflict keepBoth: remote copy saved as ${conflictPath}`
        );
        continue;
      }

      if (reason === "delete-modify-remote") {
        await this.copyLocalFile(conflict.path, conflictPath);
        await this.log(
          "warn",
          `Conflict keepBoth: local copy saved as ${conflictPath}`
        );
      }

      if (reason === "local-missing-remote") {
        await this.pullRemoteFile(conflict.path, config.branch);
        await this.log(
          "warn",
          `Conflict keepBoth: remote restored ${conflict.path}`
        );
      }
    }
  }

  private nextConflictPath(path: string, tag: string): string {
    const normalized = normalizePath(path);
    const timestamp = this.formatTimestamp(new Date());
    const dotIndex = normalized.lastIndexOf(".");
    const hasExt = dotIndex > normalized.lastIndexOf("/");
    const base = hasExt ? normalized.slice(0, dotIndex) : normalized;
    const ext = hasExt ? normalized.slice(dotIndex) : "";
    let candidate = `${base} (${tag}-${timestamp})${ext}`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${base} (${tag}-${timestamp}-${counter})${ext}`;
      counter += 1;
    }
    return candidate;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}-${hours}${minutes}`;
  }

  private buildBaseline(
    local: LocalIndex,
    remote: RemoteIndex,
    commitSha?: string
  ): SyncBaseline {
    const entries: SyncBaseline["entries"] = {};
    const paths = new Set<string>([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    for (const path of paths) {
      const localEntry = local[path];
      const remoteEntry = remote[path];
      entries[path] = {
        path,
        hash: localEntry?.hash,
        mtime: localEntry?.mtime,
        sha: remoteEntry?.sha,
        lastCommitTime: remoteEntry?.lastCommitTime,
      };
    }

    return { entries, commitSha };
  }

  private buildIncrementalBaseline(
    local: LocalIndex,
    remote: RemoteIndex,
    finalOps: SyncOp[],
    conflicts: SyncOp[],
    commitSha?: string
  ): SyncBaseline {
    // Start with the current state before operations
    const entries: SyncBaseline["entries"] = {};

    // Initialize baseline from current local and remote indices
    const allPaths = new Set<string>([
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    for (const path of allPaths) {
      const localEntry = local[path];
      const remoteEntry = remote[path];
      entries[path] = {
        path,
        hash: localEntry?.hash,
        mtime: localEntry?.mtime,
        sha: remoteEntry?.sha,
        lastCommitTime: remoteEntry?.lastCommitTime,
      };
    }

    // Apply operations to baseline
    for (const op of finalOps) {
      if (op.type === "pull_new" || op.type === "pull_update") {
        // File was pulled from remote, sync local and remote state
        const remoteEntry = remote[op.path];
        if (remoteEntry) {
          // We don't know the new local hash/mtime without rescanning,
          // but we know it should match remote SHA
          entries[op.path] = {
            path: op.path,
            sha: remoteEntry.sha,
            lastCommitTime: remoteEntry.lastCommitTime,
            // Leave hash and mtime undefined - will be computed on next sync
          };
        }
      } else if (op.type === "push_new" || op.type === "push_update") {
        // File was pushed to remote, sync local and remote state
        const localEntry = local[op.path];
        if (localEntry) {
          entries[op.path] = {
            path: op.path,
            hash: localEntry.hash,
            mtime: localEntry.mtime,
            // SHA will be updated after push, leave undefined for now
          };
        }
      } else if (op.type === "pull_delete") {
        // File was deleted locally
        delete entries[op.path];
      } else if (op.type === "push_delete") {
        // File was deleted remotely
        delete entries[op.path];
      } else if (op.type === "rename_local") {
        // Local file was renamed to match remote
        const remoteEntry = remote[op.to];
        delete entries[op.from];
        if (remoteEntry) {
          entries[op.to] = {
            path: op.to,
            sha: remoteEntry.sha,
            lastCommitTime: remoteEntry.lastCommitTime,
          };
        }
      } else if (op.type === "rename_remote") {
        // Remote file will be renamed to match local
        const localEntry = local[op.to];
        delete entries[op.from];
        if (localEntry) {
          entries[op.to] = {
            path: op.to,
            hash: localEntry.hash,
            mtime: localEntry.mtime,
          };
        }
      }
    }

    // Handle keepBoth conflicts - both versions exist
    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        if (conflict.type === "conflict") {
          const localEntry = local[conflict.path];
          const remoteEntry = remote[conflict.path];
          if (localEntry && remoteEntry) {
            // Both exist, sync the state
            entries[conflict.path] = {
              path: conflict.path,
              hash: localEntry.hash,
              mtime: localEntry.mtime,
              sha: remoteEntry.sha,
              lastCommitTime: remoteEntry.lastCommitTime,
            };
          }
        }
      }
    }

    return { entries, commitSha };
  }

  private async log(level: "info" | "warn" | "error", message: string): Promise<void> {
    await this.stateStore.appendLog({
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }

  private reportProgress(config: SyncConfig, progress: SyncProgress): void {
    if (config.onProgress) {
      // Calculate percentage if current and total are provided
      if (progress.current !== undefined && progress.total !== undefined && progress.total > 0) {
        progress.percentage = Math.round((progress.current / progress.total) * 100);
      }
      config.onProgress(progress);
    }
  }

  private async runOp(
    label: string,
    failures: string[],
    fn: () => Promise<void>
  ): Promise<void> {
    try {
      await fn();
      await this.log("info", `Op ok: ${label}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${label}: ${message}`);
      await this.log("error", `Op failed: ${label}: ${message}`);
    }
  }
}
