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
import { ConflictActionRunner } from "./core/conflict-action-runner";
import type { ConflictRecord } from "./types/sync-types";

export default class GitHubApiSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private syncIntervalId: number | null = null;
  private isSyncing = false;
  private syncStatusNotice: Notice | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
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
        await this.runSync();
      },
    });

    this.addCommand({
      id: "sync-log",
      name: "Show sync log",
      callback: () => {
        new SyncLogModal(this).open();
      },
    });

    this.addCommand({
      id: "sync-conflicts",
      name: "Show sync conflicts",
      callback: () => {
        new ConflictModal(this).open();
      },
    });

    this.scheduleSync();
  }

  onunload(): void {
    this.clearSyncInterval();
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    // Preserve existing state (baseline, conflicts, logs) when saving settings
    const existing = await this.loadData();
    const persistedSettings = sanitizeSettingsForPersistence(this.settings);
    await this.saveData({
      baseline: existing?.baseline ?? null,
      conflicts: existing?.conflicts ?? [],
      logs: existing?.logs ?? [],
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

  async resolveConflict(
    record: ConflictRecord,
    action: "keepLocal" | "keepRemote" | "keepBoth"
  ): Promise<void> {
    const { token, owner, repo, ignorePatterns, repoScopeMode, repoSubfolder } = this.settings;
    const branch = this.settings.branch.trim() || "main";
    if (!token || !owner || !repo) {
      new Notice("Missing GitHub settings (token/owner/repo).");
      return;
    }

    const client = new GitHubApiClient(token, owner, repo);
    const runner = new ConflictActionRunner(this.app, client);
    const store = new PluginStateStore(this);

    // Always ignore the config directory (user-configurable, typically .obsidian/)
    const configDirPattern = `${this.app.vault.configDir}/`;
    const effectiveIgnorePatterns = ignorePatterns.includes(configDirPattern)
      ? ignorePatterns
      : [...ignorePatterns, configDirPattern];

    try {
      await runner.resolve(record, action, {
        token,
        owner,
        repo,
        branch,
        rootPath: this.settings.rootPath,
        repoScopeMode,
        repoSubfolder,
        ignorePatterns: effectiveIgnorePatterns,
        conflictPolicy: this.settings.conflictPolicy,
        syncIntervalMinutes: this.settings.syncIntervalMinutes ?? undefined,
        maxFileSizeMB: this.settings.maxFileSizeMB,
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
    // Prevent concurrent sync operations
    if (this.isSyncing) {
      new Notice("Sync is already in progress.");
      return;
    }

    this.isSyncing = true;

    // Add spinning animation to ribbon icon
    if (this.ribbonIconEl) {
      this.ribbonIconEl.addClass("is-syncing");
    }

    try {
      const {
        token,
        owner,
        repo,
        rootPath,
        repoScopeMode,
        repoSubfolder,
        ignorePatterns,
        conflictPolicy,
      } = this.settings;
      const branch = this.settings.branch.trim() || "main";
      if (!token || !owner || !repo) {
        new Notice("Missing GitHub settings (token/owner/repo).");
        return;
      }

      if (rootPath.trim().length > 0) {
        const rootEntry = this.app.vault.getAbstractFileByPath(rootPath.trim());
        if (!rootEntry || !(rootEntry instanceof TFolder)) {
          new Notice("Root path does not exist or is not a folder.");
          return;
        }
      }

      // Always ignore the config directory (user-configurable, typically .obsidian/)
      const configDirPattern = `${this.app.vault.configDir}/`;
      const effectiveIgnorePatterns = ignorePatterns.includes(configDirPattern)
        ? ignorePatterns
        : [...ignorePatterns, configDirPattern];

      const gitClient = new GitHubApiClient(token, owner, repo);
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

      try {
        const repoInfo = await gitClient.getRepoInfo();
        if (repoInfo.permissions && repoInfo.permissions.push === false) {
          new Notice("Token does not have push permission for this repo.");
          return;
        }
        await gitClient.getCommitInfo(branch);
        await engine.sync({
          token,
          owner,
          repo,
          branch,
          rootPath,
          repoScopeMode,
          repoSubfolder,
          ignorePatterns: effectiveIgnorePatterns,
          conflictPolicy,
          syncIntervalMinutes: this.settings.syncIntervalMinutes ?? undefined,
          maxFileSizeMB: this.settings.maxFileSizeMB,
          onProgress: (progress) => {
            // Update status notice with progress
            const message = progress.percentage !== undefined
              ? `${progress.message} (${progress.percentage}%)`
              : progress.message;

            if (this.syncStatusNotice) {
              this.syncStatusNotice.setMessage(message);
            } else {
              this.syncStatusNotice = new Notice(message, 0); // 0 = don't auto-hide
            }
          },
        });

        // Hide status notice and show completion
        if (this.syncStatusNotice) {
          this.syncStatusNotice.hide();
          this.syncStatusNotice = null;
        }
        new Notice("Sync completed.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Sync failed: ${message}`);
      }
    } finally {
      // Clean up status notice in case of error
      if (this.syncStatusNotice) {
        this.syncStatusNotice.hide();
        this.syncStatusNotice = null;
      }

      // Remove spinning animation from ribbon icon
      if (this.ribbonIconEl) {
        this.ribbonIconEl.removeClass("is-syncing");
      }

      this.isSyncing = false;
    }
  }
}
