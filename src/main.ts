import { Notice, Plugin, TFolder } from "obsidian";
import type { PluginSettings } from "./types/plugin-settings";
import { DEFAULT_SETTINGS, sanitizeSettingsForPersistence } from "./types/plugin-settings";
import { SettingsView } from "./ui/settings-view";
import { DefaultSyncEngine } from "./core/sync-engine";
import { DefaultSyncPlanner } from "./core/sync-planner";
import { DefaultConflictResolver } from "./core/conflict-resolver";
import { LocalVaultIndexer } from "./indexers/local-indexer";
import { GitHubRemoteIndexer } from "./indexers/remote-indexer";
import { PluginStateStore } from "./storage/state-store";
import { GitHubApiClient } from "./clients/github-client";
import { SyncLogModal } from "./ui/sync-log-modal";
import { ConflictModal } from "./ui/conflict-modal";
import { SyncPreviewModal } from "./ui/sync-preview-modal";
import { SyncHealthModal } from "./ui/sync-health-modal";
import { ConflictActionRunner } from "./core/conflict-action-runner";
import type { ConflictRecord, SyncConfig } from "./types/sync-types";
import { GitHubAuthManager } from "./auth/github-auth-manager";
import { extractPluginSettings } from "./types/plugin-settings";

export default class GitHubApiSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private syncIntervalId: number | null = null;
  private isSyncing = false;
  private syncStatusNotice: Notice | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new SettingsView(this.app, this));

    // Add ribbon icon for quick sync
    this.ribbonIconEl = this.addRibbonIcon("refresh-cw", "GitHub sync", async (_evt: MouseEvent) => {
      await this.runSync();
    });
    // Add class for custom styling if needed
    this.ribbonIconEl.addClass("github-sync-ribbon-icon");

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: async () => {
        await this.triggerSyncNow();
      },
    });

    this.addCommand({
      id: "sync-log",
      name: "Show sync log",
      callback: () => {
        this.openSyncLog();
      },
    });

    this.addCommand({
      id: "sync-conflicts",
      name: "Show sync conflicts",
      callback: () => {
        this.openSyncConflicts();
      },
    });

    this.addCommand({
      id: "sync-preview",
      name: "Preview sync plan",
      callback: async () => {
        await this.triggerSyncPreview();
      },
    });

    this.addCommand({
      id: "sync-approve-and-run",
      name: "Approve destructive sync and run",
      callback: async () => {
        await this.triggerApprovedSync();
      },
    });

    this.addCommand({
      id: "sync-health",
      name: "Show sync health",
      callback: () => {
        this.openSyncHealth();
      },
    });

    this.addCommand({
      id: "sync-repair-baseline",
      name: "Repair sync baseline",
      callback: async () => {
        await this.triggerRepairBaseline();
      },
    });

    this.scheduleSync();
  }

  override onunload(): void {
    this.clearSyncInterval();
  }

  async loadSettings(): Promise<void> {
    const data: unknown = await this.loadData();
    this.settings = extractPluginSettings(data) ?? { ...DEFAULT_SETTINGS };
  }

  async saveSettings(): Promise<void> {
    // Preserve existing state (baseline, conflicts, logs) when saving settings
    const existing = (await this.loadData()) as
      | {
          auth?: unknown;
          baseline?: unknown;
          conflicts?: unknown;
          logs?: unknown;
          preview?: unknown;
          health?: unknown;
        }
      | null;
    const persistedSettings = sanitizeSettingsForPersistence(this.settings);
    await this.saveData({
      auth: existing?.auth ?? null,
      baseline: existing?.baseline ?? null,
      conflicts: existing?.conflicts ?? [],
      logs: existing?.logs ?? [],
      preview: existing?.preview ?? null,
      health: existing?.health ?? null,
      ...persistedSettings,
    });
    this.scheduleSync();
  }

  async loadSyncLogs() {
    const store = new PluginStateStore(this);
    return store.loadLogs();
  }

  async loadConflicts() {
    const store = new PluginStateStore(this);
    return store.loadConflicts();
  }

  async loadSyncPreview() {
    const store = new PluginStateStore(this);
    return store.loadPreview();
  }

  async loadSyncHealth() {
    const store = new PluginStateStore(this);
    return store.loadHealth();
  }

  async triggerSyncNow(): Promise<void> {
    await this.runSync();
  }

  async triggerSyncPreview(): Promise<void> {
    await this.runPreview();
  }

  async triggerApprovedSync(): Promise<void> {
    await this.runApprovedSync();
  }

  async triggerRepairBaseline(): Promise<void> {
    await this.repairBaseline();
  }

  openSyncLog(): void {
    new SyncLogModal(this).open();
  }

  openSyncConflicts(): void {
    new ConflictModal(this).open();
  }

  openSyncPreview(): void {
    new SyncPreviewModal(this).open();
  }

  openSyncHealth(): void {
    new SyncHealthModal(this).open();
  }

  async resolveConflict(
    record: ConflictRecord,
    action: "keepLocal" | "keepRemote" | "keepBoth"
  ): Promise<void> {
    const { owner, repo, ignorePatterns, repoScopeMode, repoSubfolder } = this.settings;
    const branch = this.settings.branch.trim() || "main";
    if (!owner || !repo) {
      new Notice("Missing GitHub settings (owner/repo).");
      return;
    }

    try {
      const { client, accessToken } = await this.createAuthenticatedGitHubClient(owner, repo);
      const runner = new ConflictActionRunner(this.app, client);
      const store = new PluginStateStore(this);

      // Always ignore the config directory (user-configurable, typically .obsidian/)
      const configDirPattern = `${this.app.vault.configDir}/`;
      const effectiveIgnorePatterns = ignorePatterns.includes(configDirPattern)
        ? ignorePatterns
        : [...ignorePatterns, configDirPattern];

      await runner.resolve(record, action, {
        token: accessToken,
        owner,
        repo,
        branch,
        rootPath: this.settings.rootPath,
        repoScopeMode,
        repoSubfolder,
        ignorePatterns: effectiveIgnorePatterns,
        conflictPolicy: this.settings.conflictPolicy,
        maxFileSizeMB: this.settings.maxFileSizeMB,
        ...(this.settings.syncIntervalMinutes !== null
          ? { syncIntervalMinutes: this.settings.syncIntervalMinutes }
          : {}),
      });

      const conflicts = await store.loadConflicts();
      const remaining = conflicts.filter(
        (entry) => !(entry.path === record.path && entry.timestamp === record.timestamp)
      );
      await store.saveConflicts(remaining);
      new Notice("Conflict resolved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Resolve failed: ${message}`);
    }
  }

  private scheduleSync(): void {
    this.clearSyncInterval();
    const minutes = this.settings.syncIntervalMinutes;
    if (!minutes || !Number.isFinite(minutes) || minutes <= 0) {
      return;
    }

    this.syncIntervalId = window.setInterval(() => {
      void this.runSync();
    }, minutes * 60 * 1000);
  }

  private clearSyncInterval(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  private async runSync(): Promise<void> {
    await this.runExclusive(async () => {
      const runtime = await this.buildSyncRuntime();
      if (!runtime) {
        return;
      }

      try {
        const repoInfo = await runtime.gitClient.getRepoInfo();
        if (repoInfo.permissions && repoInfo.permissions.push === false) {
          new Notice("Current GitHub credentials do not have push permission for this repo.");
          return;
        }

        await runtime.engine.sync({
          ...runtime.config,
          onProgress: (progress) => {
            const message =
              progress.percentage !== undefined
                ? `${progress.message} (${progress.percentage}%)`
                : progress.message;

            if (this.syncStatusNotice) {
              this.syncStatusNotice.setMessage(message);
            } else {
              this.syncStatusNotice = new Notice(message, 0);
            }
          },
        });
        new Notice("Sync completed.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Sync failed: ${message}`);
        if (message.startsWith("Sync blocked:")) {
          this.openSyncPreview();
        }
      }
    });
  }

  private async createAuthenticatedGitHubClient(
    owner: string,
    repo: string
  ): Promise<{ client: GitHubApiClient; accessToken: string; authStatus: string }> {
    const authManager = new GitHubAuthManager(this);
    const authState = await authManager.loadGitHubAppAuthState();
    const { accessToken } = await authManager.ensureAuthenticatedSession();
    return {
      accessToken,
      authStatus: authState?.status ?? "connected",
      client: new GitHubApiClient(accessToken, owner, repo, {
        onUnauthorized: async () => authManager.handleAuthenticationFailure(),
      }),
    };
  }

  private async runPreview(): Promise<void> {
    await this.runExclusive(async () => {
      const runtime = await this.buildSyncRuntime();
      if (!runtime) {
        return;
      }

      try {
        await runtime.engine.preview(runtime.config);
        this.openSyncPreview();
        new Notice("Sync preview generated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Preview failed: ${message}`);
      }
    });
  }

  private async runApprovedSync(): Promise<void> {
    const preview = await this.loadSyncPreview();
    if (!preview || !preview.approval.required || !preview.approval.key) {
      new Notice("No approval-requiring sync preview is currently stored.");
      return;
    }

    await this.runExclusive(async () => {
      const runtime = await this.buildSyncRuntime();
      if (!runtime) {
        return;
      }

      try {
        await runtime.engine.sync({
          ...runtime.config,
          approvalKey: preview.approval.key,
          onProgress: (progress) => {
            const message =
              progress.percentage !== undefined
                ? `${progress.message} (${progress.percentage}%)`
                : progress.message;

            if (this.syncStatusNotice) {
              this.syncStatusNotice.setMessage(message);
            } else {
              this.syncStatusNotice = new Notice(message, 0);
            }
          },
        });
        new Notice("Approved sync completed.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Approved sync failed: ${message}`);
      }
    });
  }

  private async repairBaseline(): Promise<void> {
    await this.runExclusive(async () => {
      const runtime = await this.buildSyncRuntime();
      if (!runtime) {
        return;
      }

      try {
        await runtime.engine.repairBaseline(runtime.config);
        this.openSyncHealth();
        new Notice("Sync baseline repaired.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Baseline repair failed: ${message}`);
      }
    });
  }

  private async buildSyncRuntime(): Promise<{
    config: SyncConfig;
    engine: DefaultSyncEngine;
    gitClient: GitHubApiClient;
  } | null> {
    const { owner, repo, rootPath, repoScopeMode, repoSubfolder, ignorePatterns, conflictPolicy } =
      this.settings;
    const branch = this.settings.branch.trim() || "main";
    if (!owner || !repo) {
      new Notice("Missing GitHub settings (owner/repo).");
      return null;
    }

    if (rootPath.trim().length > 0) {
      const rootEntry = this.app.vault.getAbstractFileByPath(rootPath.trim());
      if (!rootEntry || !(rootEntry instanceof TFolder)) {
        new Notice("Local sync root does not exist or is not a folder.");
        return null;
      }
    }

    const configDirPattern = `${this.app.vault.configDir}/`;
    const effectiveIgnorePatterns = ignorePatterns.includes(configDirPattern)
      ? ignorePatterns
      : [...ignorePatterns, configDirPattern];

    const { client: gitClient, accessToken, authStatus } = await this.createAuthenticatedGitHubClient(
      owner,
      repo
    );
    const localIndexer = new LocalVaultIndexer(this.app);
    const remoteIndexer = new GitHubRemoteIndexer(gitClient);
    const planner = new DefaultSyncPlanner();
    const resolver = new DefaultConflictResolver();
    const stateStore = new PluginStateStore(this);
    const engine = new DefaultSyncEngine(
      this.app,
      gitClient,
      localIndexer,
      remoteIndexer,
      planner,
      resolver,
      stateStore
    );

    return {
      config: {
        token: accessToken,
        authStatus,
        owner,
        repo,
        branch,
        rootPath,
        repoScopeMode,
        repoSubfolder,
        ignorePatterns: effectiveIgnorePatterns,
        conflictPolicy,
        maxFileSizeMB: this.settings.maxFileSizeMB,
        ...(this.settings.syncIntervalMinutes !== null
          ? { syncIntervalMinutes: this.settings.syncIntervalMinutes }
          : {}),
      },
      engine,
      gitClient,
    };
  }

  private async runExclusive(action: () => Promise<void>): Promise<void> {
    if (this.isSyncing) {
      new Notice("Sync is already in progress.");
      return;
    }

    this.isSyncing = true;
    if (this.ribbonIconEl) {
      this.ribbonIconEl.addClass("github-sync-ribbon-icon--syncing");
    }

    try {
      await action();
    } finally {
      if (this.syncStatusNotice) {
        this.syncStatusNotice.hide();
        this.syncStatusNotice = null;
      }
      if (this.ribbonIconEl) {
        this.ribbonIconEl.removeClass("github-sync-ribbon-icon--syncing");
      }
      this.isSyncing = false;
    }
  }
}
