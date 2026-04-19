import { normalizePath, type App, TFile } from "obsidian";
import type {
  ConflictRecord,
  LocalIndex,
  RemoteIndex,
  SyncApprovalRequirement,
  SyncBaseline,
  SyncConfig,
  SyncDiagnosticEntry,
  SyncHealthState,
  SyncOp,
  SyncOpCounts,
  SyncPlanSummary,
  SyncPreview,
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
import { hasHiddenPathSegment, isIgnoredPath } from "../utils/path-filter";
import { runtimeLog } from "../utils/runtime-log";

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

type PreparedSyncPlan = {
  baseline: SyncBaseline | null;
  local: LocalIndex;
  remote: RemoteIndex;
  remotePlaceholderDirectories: string[];
  conflicts: SyncOp[];
  conflictRecords: ConflictRecord[];
  finalOps: Array<Exclude<SyncOp, { type: "conflict" }>>;
  preview: SyncPreview;
};

/**
 * Orchestrates sync execution, preview generation, delete-safety approval, and
 * baseline repair while keeping user-visible state persisted for later review.
 */
export class DefaultSyncEngine implements SyncEngine {
  private static readonly MASS_DELETE_MIN_FILES = 10;
  private static readonly MASS_DELETE_RATIO_THRESHOLD = 0.5;

  private readonly app: App;
  private readonly gitClient: GitHubClient;
  private readonly localIndexer: LocalIndexer;
  private readonly remoteIndexer: RemoteIndexer;
  private readonly planner: SyncPlanner;
  private readonly resolver: ConflictResolver;
  private readonly stateStore: StateStore;

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
    let prepared: PreparedSyncPlan | null = null;
    let healthPersisted = false;

    try {
      this.reportProgress(config, {
        stage: "scanning",
        message: "Loading baseline and scanning files...",
      });

      prepared = await this.prepareSyncPlan(config);
      await this.stateStore.savePreview?.(prepared.preview);
      await this.stateStore.saveConflicts(prepared.conflictRecords);

      if (
        prepared.preview.approval.required &&
        config.approvalKey !== prepared.preview.approval.key
      ) {
        await this.log(
          "warn",
          `Sync blocked pending approval for ${prepared.preview.approval.pullDeleteCount} local deletions.`
        );
        await this.persistHealth(
          this.buildHealthState(config, prepared.preview, "sync", "blocked", prepared.preview.approval.reason ?? "Sync blocked pending approval.")
        );
        healthPersisted = true;
        throw new Error(
          "Sync blocked: preview requires approval for a large set of local deletions. Review the preview and run the approval command if the change is intentional."
        );
      }

      this.reportProgress(config, {
        stage: "executing",
        message: `Executing ${prepared.finalOps.length} operations...`,
        total: prepared.finalOps.length,
      });

      await this.executeOps(
        prepared.finalOps,
        prepared.conflicts,
        config,
        prepared.local,
        prepared.remote
      );
      await this.cleanupLocalSyncArtifacts(config, prepared.remotePlaceholderDirectories);

      this.reportProgress(config, {
        stage: "saving",
        message: "Saving sync state...",
      });

      const commitInfo = await this.gitClient.getCommitInfo(config.branch);
      const updatedRemoteRaw = await this.remoteIndexer.fetchIndex(
        config.owner,
        config.repo,
        config.branch,
        null,
        this.getRepoSubfolder(config)
      );
      const updatedRemote = this.filterRemoteIndex(updatedRemoteRaw, config);
      const updatedLocal = await this.localIndexer.scan(config.rootPath, config.ignorePatterns);
      const baselineSnapshot = this.buildBaseline(
        updatedLocal,
        updatedRemote,
        commitInfo.sha,
        this.remoteIndexer.getLastFetchMeta?.()?.placeholderDirectories ?? []
      );

      await this.stateStore.saveBaseline(baselineSnapshot);
      await this.stateStore.savePreview?.(null);
      await this.persistHealth(
        this.buildHealthState(config, prepared.preview, "sync", "success", "Sync completed.")
      );
      healthPersisted = true;
      await this.log("info", "Sync completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!healthPersisted) {
        await this.persistHealth(
          this.buildHealthState(
            config,
            prepared?.preview ?? this.buildEmptyPreview(config),
            "sync",
            "failed",
            message
          )
        );
      }
      await this.log("error", `Sync failed: ${message}`);
      throw error;
    }
  }

  async preview(config: SyncConfig): Promise<SyncPreview> {
    await this.log("info", "Sync preview started.");
    try {
      const prepared = await this.prepareSyncPlan(config);
      const preview: SyncPreview = {
        ...prepared.preview,
        diagnostics: [
          ...prepared.preview.diagnostics,
          {
            code: "preview_generated",
            level: "info",
            message: "Preview generated from the current local, remote, and baseline state.",
          },
        ],
      };

      await this.stateStore.savePreview?.(preview);
      await this.stateStore.saveConflicts(prepared.conflictRecords);
      await this.persistHealth(
        this.buildHealthState(config, preview, "preview", "preview", "Sync preview generated.")
      );
      await this.log("info", "Sync preview generated.");
      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackPreview = this.buildEmptyPreview(config);
      await this.persistHealth(
        this.buildHealthState(config, fallbackPreview, "preview", "failed", message)
      );
      await this.log("error", `Sync preview failed: ${message}`);
      throw error;
    }
  }

  async repairBaseline(config: SyncConfig): Promise<SyncBaseline> {
    await this.log("info", "Baseline repair started.");
    try {
      const existingBaseline = await this.stateStore.loadBaseline();
      this.localIndexer.setPreviousBaseline(existingBaseline);

      if (config.maxFileSizeMB) {
        this.localIndexer.setMaxFileSizeMB(config.maxFileSizeMB);
      }

      const [local, remoteRaw, commitInfo] = await Promise.all([
        this.localIndexer.scan(config.rootPath, config.ignorePatterns),
        this.remoteIndexer.fetchIndex(
          config.owner,
          config.repo,
          config.branch,
          null,
          this.getRepoSubfolder(config)
        ),
        this.gitClient.getCommitInfo(config.branch),
      ]);
      const remote = this.filterRemoteIndex(remoteRaw, config);
      const snapshot = this.buildBaseline(
        local,
        remote,
        commitInfo.sha,
        this.remoteIndexer.getLastFetchMeta?.()?.placeholderDirectories ?? []
      );
      await this.stateStore.saveBaseline(snapshot);
      await this.stateStore.savePreview?.(null);

      const diagnostics = [
        ...(this.remoteIndexer.getLastFetchMeta()?.diagnostics ?? []),
        {
          code: "baseline_repaired",
          level: "info",
          message: "Baseline rebuilt from the current local and remote state.",
        } satisfies SyncDiagnosticEntry,
      ];
      const preview = this.buildPreview(config, local, remote, snapshot, [], [], diagnostics);
      await this.persistHealth(
        this.buildHealthState(
          config,
          preview,
          "repair-baseline",
          "repaired",
          "Baseline repaired from current local and remote state."
        )
      );
      await this.log("info", "Baseline repair completed.");
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persistHealth(
        this.buildHealthState(
          config,
          this.buildEmptyPreview(config),
          "repair-baseline",
          "failed",
          message
        )
      );
      await this.log("error", `Baseline repair failed: ${message}`);
      throw error;
    }
  }

  private async prepareSyncPlan(config: SyncConfig): Promise<PreparedSyncPlan> {
    const baseline = await this.stateStore.loadBaseline();
    this.localIndexer.setPreviousBaseline(baseline);

    if (config.maxFileSizeMB) {
      this.localIndexer.setMaxFileSizeMB(config.maxFileSizeMB);
    }

    const [local, remoteRaw] = await Promise.all([
      this.localIndexer.scan(config.rootPath, config.ignorePatterns),
      this.remoteIndexer.fetchIndex(
        config.owner,
        config.repo,
        config.branch,
        baseline,
        this.getRepoSubfolder(config)
      ),
    ]);
    const remote = this.filterRemoteIndex(remoteRaw, config);

    this.reportProgress(config, {
      stage: "planning",
      message: "Planning sync operations...",
    });

    const { ops, conflicts } = this.planner.plan(local, remote, baseline);
    const { resolvedOps, conflictRecords } = this.resolver.resolve(conflicts, config.conflictPolicy);
    const finalOps = [
      ...ops.filter((op): op is Exclude<SyncOp, { type: "conflict" }> => op.type !== "conflict"),
      ...resolvedOps.filter((op): op is Exclude<SyncOp, { type: "conflict" }> => op.type !== "conflict"),
    ];

    const diagnostics = [...(this.remoteIndexer.getLastFetchMeta?.()?.diagnostics ?? [])];
    const preview = this.buildPreview(
      config,
      local,
      remote,
      baseline,
      finalOps,
      conflictRecords,
      diagnostics
    );

    await this.log(
      "info",
      `Plan summary: ${preview.summary.localFileCount} local, ${preview.summary.remoteFileCount} remote, ${preview.summary.baselineFileCount} baseline, ${preview.summary.conflictCount} conflicts.`
    );

    return {
      baseline,
      local,
      remote,
      remotePlaceholderDirectories:
        this.remoteIndexer.getLastFetchMeta?.()?.placeholderDirectories ?? [],
      conflicts,
      conflictRecords,
      finalOps,
      preview,
    };
  }

  private buildPreview(
    config: SyncConfig,
    local: LocalIndex,
    remote: RemoteIndex,
    baseline: SyncBaseline | null,
    finalOps: Array<Exclude<SyncOp, { type: "conflict" }>>,
    conflictRecords: ConflictRecord[],
    diagnostics: SyncDiagnosticEntry[]
  ): SyncPreview {
    const summary = this.buildPlanSummary(local, remote, baseline, finalOps, conflictRecords);
    const approval = this.buildApprovalRequirement(config, baseline, summary, finalOps);
    const nextDiagnostics = [...diagnostics];

    if (approval.required) {
      nextDiagnostics.push({
        code: "mass_delete_approval_required",
        level: "warn",
        message: approval.reason ?? "Large local delete set requires explicit approval before sync.",
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      rootPath: config.rootPath,
      repoScopeMode: config.repoScopeMode,
      repoSubfolder: config.repoSubfolder,
      summary,
      diagnostics: nextDiagnostics,
      ops: finalOps,
      conflicts: conflictRecords,
      approval,
    };
  }

  private buildEmptyPreview(config: SyncConfig): SyncPreview {
    return {
      generatedAt: new Date().toISOString(),
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      rootPath: config.rootPath,
      repoScopeMode: config.repoScopeMode,
      repoSubfolder: config.repoSubfolder,
      summary: {
        localFileCount: 0,
        remoteFileCount: 0,
        baselineFileCount: 0,
        conflictCount: 0,
        counts: this.emptyCounts(),
      },
      diagnostics: [],
      ops: [],
      conflicts: [],
      approval: {
        required: false,
        key: null,
        reason: null,
        pullDeleteCount: 0,
        deleteRatio: 0,
        thresholdRatio: DefaultSyncEngine.MASS_DELETE_RATIO_THRESHOLD,
      },
    };
  }

  private buildPlanSummary(
    local: LocalIndex,
    remote: RemoteIndex,
    baseline: SyncBaseline | null,
    finalOps: Array<Exclude<SyncOp, { type: "conflict" }>>,
    conflictRecords: ConflictRecord[]
  ): SyncPlanSummary {
    const counts = this.emptyCounts();
    for (const op of finalOps) {
      if (op.type === "pull_new") {
        counts.pullNew += 1;
      } else if (op.type === "pull_update") {
        counts.pullUpdate += 1;
      } else if (op.type === "pull_delete") {
        counts.pullDelete += 1;
      } else if (op.type === "push_new") {
        counts.pushNew += 1;
      } else if (op.type === "push_update") {
        counts.pushUpdate += 1;
      } else if (op.type === "push_delete") {
        counts.pushDelete += 1;
      } else if (op.type === "rename_local") {
        counts.renameLocal += 1;
      } else if (op.type === "rename_remote") {
        counts.renameRemote += 1;
      }
    }

    return {
      localFileCount: Object.keys(local).length,
      remoteFileCount: Object.keys(remote).length,
      baselineFileCount: Object.keys(baseline?.entries ?? {}).length,
      conflictCount: conflictRecords.length,
      counts,
    };
  }

  private buildApprovalRequirement(
    config: SyncConfig,
    baseline: SyncBaseline | null,
    summary: SyncPlanSummary,
    finalOps: Array<Exclude<SyncOp, { type: "conflict" }>>
  ): SyncApprovalRequirement {
    const pullDeleteCount = summary.counts.pullDelete;
    const denominator = Math.max(summary.baselineFileCount, summary.localFileCount, 1);
    const deleteRatio = denominator > 0 ? pullDeleteCount / denominator : 0;
    const remoteLooksWiped =
      summary.remoteFileCount === 0 &&
      summary.localFileCount >= DefaultSyncEngine.MASS_DELETE_MIN_FILES &&
      summary.baselineFileCount >= DefaultSyncEngine.MASS_DELETE_MIN_FILES;
    const deleteSetIsLarge =
      pullDeleteCount >= DefaultSyncEngine.MASS_DELETE_MIN_FILES &&
      deleteRatio >= DefaultSyncEngine.MASS_DELETE_RATIO_THRESHOLD;
    const required = remoteLooksWiped || deleteSetIsLarge;

    if (!required) {
      return {
        required: false,
        key: null,
        reason: null,
        pullDeleteCount,
        deleteRatio,
        thresholdRatio: DefaultSyncEngine.MASS_DELETE_RATIO_THRESHOLD,
      };
    }

    const reason = remoteLooksWiped
      ? "Remote repository appears to have lost most or all tracked files. Approval is required before deleting local files."
      : `This sync would delete ${pullDeleteCount} local file(s), which exceeds the safety threshold.`;
    const paths = finalOps
      .filter((op): op is { type: "pull_delete"; path: string } => op.type === "pull_delete")
      .map((op) => op.path)
      .sort()
      .join("|");
    const key = `approve-${this.hashString(
      JSON.stringify({
        owner: config.owner,
        repo: config.repo,
        branch: config.branch,
        rootPath: config.rootPath,
        repoScopeMode: config.repoScopeMode,
        repoSubfolder: config.repoSubfolder,
        baselineCommit: baseline?.commitSha ?? "",
        pullDeleteCount,
        paths,
      })
    )}`;

    return {
      required: true,
      key,
      reason,
      pullDeleteCount,
      deleteRatio,
      thresholdRatio: DefaultSyncEngine.MASS_DELETE_RATIO_THRESHOLD,
    };
  }

  private buildHealthState(
    config: SyncConfig,
    preview: SyncPreview,
    action: SyncHealthState["lastAction"],
    result: SyncHealthState["lastResult"],
    message: string
  ): SyncHealthState {
    return {
      updatedAt: new Date().toISOString(),
      lastAction: action,
      lastResult: result,
      lastMessage: message,
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      rootPath: config.rootPath,
      repoScopeMode: config.repoScopeMode,
      repoSubfolder: config.repoSubfolder,
      baselineEntryCount: preview.summary.baselineFileCount,
      previewApprovalRequired: preview.approval.required,
      previewApprovalKey: preview.approval.key,
      authStatus: config.authStatus ?? "unknown",
      diagnostics: preview.diagnostics,
      rateLimit: this.gitClient.getLastRateLimitSnapshot?.() ?? null,
    };
  }

  private async persistHealth(health: SyncHealthState): Promise<void> {
    await this.stateStore.saveHealth?.(health);
  }

  private async executeOps(
    ops: Array<Exclude<SyncOp, { type: "conflict" }>>,
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
        this.pullRemoteFile(op.path, config)
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

  private async pullRemoteFile(path: string, config: SyncConfig): Promise<void> {
    const normalized = normalizePath(path);
    const { content } = await this.gitClient.getFile(
      this.toRemotePath(normalized, this.getRepoSubfolder(config)),
      config.branch
    );
    const buffer = Buffer.from(content, "base64");
    await this.ensureParentFolder(normalized);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing && existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, toArrayBuffer(buffer));
      return;
    }

    await this.app.vault.createBinary(normalized, toArrayBuffer(buffer));
  }

  private async pullRemoteCopy(
    path: string,
    targetPath: string,
    config: SyncConfig
  ): Promise<void> {
    const normalized = normalizePath(path);
    const { content } = await this.gitClient.getFile(
      this.toRemotePath(normalized, this.getRepoSubfolder(config)),
      config.branch
    );
    const buffer = Buffer.from(content, "base64");
    await this.ensureParentFolder(targetPath);
    await this.app.vault.createBinary(targetPath, toArrayBuffer(buffer));
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
        runtimeLog.warn(`batchPush: file not found for update ${normalized}.`);
        continue;
      }

      try {
        const data = await this.app.vault.readBinary(abstractFile);
        const contentBase64 = Buffer.from(data).toString("base64");
        const blobSha = await this.gitClient.createBlob(contentBase64);
        entries.push({
          path: this.toRemotePath(normalized, this.getRepoSubfolder(config)),
          sha: blobSha,
          mode: "100644",
          type: "blob",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeLog.error(`batchPush: failed to process update ${normalized}: ${message}`);
        throw new Error(`Failed to process an update operation: ${message}`);
      }
    }

    for (const path of deletes) {
      entries.push({
        path: this.toRemotePath(normalizePath(path), this.getRepoSubfolder(config)),
        sha: null,
        mode: "100644",
        type: "blob",
      });
    }

    if (entries.length === 0) {
      return;
    }

    const treeSha = await this.gitClient.createTree({
      ...(baseTreeSha ? { baseTreeSha } : {}),
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

      if (reason === "modify-modify" || reason === "delete-modify-local") {
        await this.pullRemoteCopy(conflict.path, conflictPath, config);
        await this.log("warn", `Conflict keepBoth: remote copy saved as ${conflictPath}`);
        continue;
      }

      if (reason === "delete-modify-remote") {
        await this.copyLocalFile(conflict.path, conflictPath);
        await this.log("warn", `Conflict keepBoth: local copy saved as ${conflictPath}`);
        continue;
      }

      if (reason === "local-missing-remote") {
        await this.pullRemoteFile(conflict.path, config);
        await this.log("warn", `Conflict keepBoth: remote restored ${conflict.path}`);
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
    commitSha?: string,
    placeholderDirectories: string[] = []
  ): SyncBaseline {
    const entries: SyncBaseline["entries"] = {};
    const paths = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);

    for (const path of paths) {
      const localEntry = local[path];
      const remoteEntry = remote[path];
      const entry = {
        path,
        ...(localEntry?.hash ? { hash: localEntry.hash } : {}),
        ...(localEntry?.mtime !== undefined ? { mtime: localEntry.mtime } : {}),
        ...(localEntry?.size !== undefined
          ? { size: localEntry.size }
          : remoteEntry?.size !== undefined
            ? { size: remoteEntry.size }
            : {}),
        ...(remoteEntry?.sha ? { sha: remoteEntry.sha } : {}),
        ...(remoteEntry?.lastCommitTime !== undefined
          ? { lastCommitTime: remoteEntry.lastCommitTime }
          : {}),
      };
      entries[path] = entry;
    }

    return {
      entries,
      ...(commitSha ? { commitSha } : {}),
      ...(placeholderDirectories.length > 0
        ? { placeholderDirectories: [...placeholderDirectories].sort() }
        : {}),
    };
  }

  private filterRemoteIndex(remote: RemoteIndex, config: SyncConfig): RemoteIndex {
    const filtered: RemoteIndex = {};

    for (const [path, entry] of Object.entries(remote)) {
      if (hasHiddenPathSegment(path) || isIgnoredPath(path, config.ignorePatterns)) {
        continue;
      }
      filtered[path] = entry;
    }

    return filtered;
  }

  private async cleanupLocalSyncArtifacts(
    config: SyncConfig,
    remotePlaceholderDirectories: string[]
  ): Promise<void> {
    const rootPath = this.getLocalRootPath(config.rootPath);
    const preservedDirectories = new Set(
      remotePlaceholderDirectories.filter((directory) =>
        rootPath ? directory === rootPath || directory.startsWith(`${rootPath}/`) : true
      )
    );
    await this.ensurePlaceholderDirectories(preservedDirectories);
    const directories = await this.collectLocalDirectories(rootPath, config.ignorePatterns);
    const cleanupTargets = rootPath ? [...directories, rootPath] : directories;

    for (const directory of cleanupTargets) {
      await this.removeOrphanedGitkeep(directory, config.ignorePatterns, preservedDirectories);
      await this.pruneEmptyDirectory(directory, rootPath, preservedDirectories);
    }
  }

  private async ensurePlaceholderDirectories(directories: Set<string>): Promise<void> {
    for (const directory of Array.from(directories).sort((left, right) => left.length - right.length)) {
      if (!directory.trim() || this.app.vault.getAbstractFileByPath(directory)) {
        continue;
      }
      await this.app.vault.createFolder(directory);
      await this.log("info", `Restored empty folder ${directory} from remote placeholder state.`);
    }
  }

  private async collectLocalDirectories(
    rootPath: string,
    ignorePatterns: string[]
  ): Promise<string[]> {
    const directories: string[] = [];
    await this.walkLocalDirectories(rootPath, ignorePatterns, directories);
    directories.sort((left, right) => right.split("/").length - left.split("/").length);
    return directories;
  }

  private async walkLocalDirectories(
    directory: string,
    ignorePatterns: string[],
    directories: string[]
  ): Promise<void> {
    const listing = await this.app.vault.adapter.list(directory);

    for (const folder of listing.folders) {
      const normalized = normalizePath(folder);
      if (hasHiddenPathSegment(normalized) || isIgnoredPath(normalized, ignorePatterns)) {
        continue;
      }

      directories.push(normalized);
      await this.walkLocalDirectories(normalized, ignorePatterns, directories);
    }
  }

  private async removeOrphanedGitkeep(
    directory: string,
    ignorePatterns: string[],
    preservedDirectories: Set<string>
  ): Promise<void> {
    const normalizedDirectory = normalizePath(directory);
    if (
      hasHiddenPathSegment(normalizedDirectory) ||
      isIgnoredPath(normalizedDirectory, ignorePatterns)
    ) {
      return;
    }

    const gitkeepPath = `${normalizedDirectory}/.gitkeep`;
    const listing = await this.app.vault.adapter.list(normalizedDirectory);
    const hasGitkeep = listing.files.some((file) => normalizePath(file) === gitkeepPath);
    if (!hasGitkeep) {
      return;
    }

    const hasVisibleFiles = listing.files.some((file) => {
      const normalized = normalizePath(file);
      return (
        normalized !== gitkeepPath &&
        !hasHiddenPathSegment(normalized) &&
        !isIgnoredPath(normalized, ignorePatterns)
      );
    });
    const hasVisibleFolders = listing.folders.some((folder) => {
      const normalized = normalizePath(folder);
      return !hasHiddenPathSegment(normalized) && !isIgnoredPath(normalized, ignorePatterns);
    });

    if (hasVisibleFiles || hasVisibleFolders) {
      return;
    }

    await this.app.vault.adapter.remove(gitkeepPath);
    await this.log("info", `Removed orphaned placeholder ${gitkeepPath}.`);

    if (preservedDirectories.has(normalizedDirectory)) {
      await this.log("info", `Kept empty folder ${normalizedDirectory} because the remote placeholder still exists.`);
    }
  }

  private async pruneEmptyDirectory(
    directory: string,
    rootPath: string,
    preservedDirectories: Set<string>
  ): Promise<void> {
    const normalizedDirectory = normalizePath(directory);
    if (!normalizedDirectory || normalizedDirectory === rootPath) {
      return;
    }
    if (preservedDirectories.has(normalizedDirectory)) {
      return;
    }

    const listing = await this.app.vault.adapter.list(normalizedDirectory);
    if (listing.files.length > 0 || listing.folders.length > 0) {
      return;
    }

    await this.app.vault.adapter.rmdir(normalizedDirectory, false);
    await this.log("info", `Removed empty folder ${normalizedDirectory}.`);
  }

  private getLocalRootPath(rootPath: string): string {
    const trimmed = rootPath.trim();
    return trimmed.length > 0 ? normalizePath(trimmed) : "";
  }

  private getRepoSubfolder(config: SyncConfig): string {
    if (config.repoScopeMode !== "subfolder") {
      return "";
    }
    const trimmed = config.repoSubfolder.trim();
    return trimmed.length > 0 ? trimmed.replace(/^\/+|\/+$/g, "") : "vault";
  }

  private toRemotePath(localPath: string, repoSubfolder: string): string {
    const normalizedLocal = normalizePath(localPath);
    return repoSubfolder ? `${repoSubfolder}/${normalizedLocal}` : normalizedLocal;
  }

  private async log(level: "info" | "warn" | "error", message: string): Promise<void> {
    await this.stateStore.appendLog({
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }

  private reportProgress(config: SyncConfig, progress: SyncProgress): void {
    if (!config.onProgress) {
      return;
    }

    const nextProgress = { ...progress };
    if (
      nextProgress.current !== undefined &&
      nextProgress.total !== undefined &&
      nextProgress.total > 0
    ) {
      nextProgress.percentage = Math.round((nextProgress.current / nextProgress.total) * 100);
    }
    config.onProgress(nextProgress);
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

  private emptyCounts(): SyncOpCounts {
    return {
      pullNew: 0,
      pullUpdate: 0,
      pullDelete: 0,
      pushNew: 0,
      pushUpdate: 0,
      pushDelete: 0,
      renameLocal: 0,
      renameRemote: 0,
    };
  }

  private hashString(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
}
