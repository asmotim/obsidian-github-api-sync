import type { ConflictRecord, SyncBaseline, SyncLogEntry } from "../types/sync-types";
import type { StateStore } from "../types/interfaces";
import type { Plugin } from "obsidian";
import type { PluginSettings } from "../types/plugin-settings";

type StoredState = {
  settings?: PluginSettings;
  baseline: SyncBaseline | null;
  conflicts: ConflictRecord[];
  logs: SyncLogEntry[];
};

export class PluginStateStore implements StateStore {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async loadBaseline(): Promise<SyncBaseline | null> {
    const state = await this.loadState();
    return state.baseline;
  }

  async saveBaseline(baseline: SyncBaseline): Promise<void> {
    const state = await this.loadFullState();
    state.baseline = baseline;
    await this.plugin.saveData(this.mergeWithSettings(state));
  }

  async saveConflicts(records: ConflictRecord[]): Promise<void> {
    const state = await this.loadFullState();
    state.conflicts = records;
    await this.plugin.saveData(this.mergeWithSettings(state));
  }

  async loadConflicts(): Promise<ConflictRecord[]> {
    const state = await this.loadState();
    return state.conflicts;
  }

  async appendLog(entry: SyncLogEntry): Promise<void> {
    const state = await this.loadFullState();
    state.logs.push(entry);
    if (state.logs.length > 500) {
      state.logs = state.logs.slice(-500);
    }
    await this.plugin.saveData(this.mergeWithSettings(state));
  }

  async loadLogs(): Promise<SyncLogEntry[]> {
    const state = await this.loadState();
    return state.logs;
  }

  private async loadState(): Promise<Omit<StoredState, "settings">> {
    const raw = await this.plugin.loadData();
    const state = (raw ?? {}) as Partial<StoredState>;
    return {
      baseline: state.baseline ?? null,
      conflicts: state.conflicts ?? [],
      logs: state.logs ?? [],
    };
  }

  private async loadFullState(): Promise<StoredState> {
    const raw = await this.plugin.loadData();
    const state = (raw ?? {}) as Partial<StoredState>;
    // Extract settings fields from top level (not nested under 'settings' key)
    return {
      settings: this.extractSettings(raw),
      baseline: state.baseline ?? null,
      conflicts: state.conflicts ?? [],
      logs: state.logs ?? [],
    };
  }

  private extractSettings(data: unknown): PluginSettings | undefined {
    if (!data || typeof data !== "object") {
      return undefined;
    }
    const obj = data as Partial<PluginSettings>;
    // Check if this looks like settings (has at least one known field)
    const hasSettings = "token" in obj || "owner" in obj || "repo" in obj;
    if (!hasSettings) {
      return undefined;
    }
    return {
      token: obj.token ?? "",
      owner: obj.owner ?? "",
      repo: obj.repo ?? "",
      branch: obj.branch ?? "main",
      rootPath: obj.rootPath ?? "",
      persistToken: obj.persistToken ?? false,
      repoScopeMode: obj.repoScopeMode ?? "fullRepo",
      repoSubfolder: obj.repoSubfolder ?? "vault",
      ignorePatterns: obj.ignorePatterns ?? [".git/"],
      conflictPolicy: obj.conflictPolicy ?? "keepBoth",
      syncIntervalMinutes: obj.syncIntervalMinutes ?? null,
      maxFileSizeMB: obj.maxFileSizeMB ?? 50,
    };
  }

  private mergeWithSettings(state: StoredState): Record<string, unknown> {
    const result: Record<string, unknown> = {
      baseline: state.baseline,
      conflicts: state.conflicts,
      logs: state.logs,
    };
    // Spread settings back to top level
    if (state.settings) {
      Object.assign(result, state.settings);
    }
    return result;
  }
}
