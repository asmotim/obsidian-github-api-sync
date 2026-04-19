import type {
  ConflictRecord,
  SyncBaseline,
  SyncHealthState,
  SyncLogEntry,
  SyncPreview,
} from "../types/sync-types";
import type { StateStore } from "../types/interfaces";
import type { Plugin } from "obsidian";
import type { PluginSettings } from "../types/plugin-settings";
import { extractPluginSettings } from "../types/plugin-settings";
import type { GitHubAppAuthState } from "../types/auth-types";
import { extractGitHubAppAuthState } from "./auth-state-store";
import { redactSensitiveText } from "../utils/redaction";

type StoredState = {
  settings?: PluginSettings;
  auth: GitHubAppAuthState | null;
  baseline: SyncBaseline | null;
  conflicts: ConflictRecord[];
  logs: SyncLogEntry[];
  preview: SyncPreview | null;
  health: SyncHealthState | null;
};

/**
 * Persists plugin runtime state without leaking auth secrets into top-level
 * settings fields. Log entries are redacted on write because logs may be shared
 * in bug reports.
 */
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
    state.logs.push({
      ...entry,
      message: redactSensitiveText(entry.message),
    });
    if (state.logs.length > 500) {
      state.logs = state.logs.slice(-500);
    }
    await this.plugin.saveData(this.mergeWithSettings(state));
  }

  async loadLogs(): Promise<SyncLogEntry[]> {
    const state = await this.loadState();
    return state.logs;
  }

  async savePreview(preview: SyncPreview | null): Promise<void> {
    const state = await this.loadFullState();
    state.preview = preview;
    await this.plugin.saveData(this.mergeWithSettings(state));
  }

  async loadPreview(): Promise<SyncPreview | null> {
    const state = await this.loadState();
    return state.preview;
  }

  async saveHealth(health: SyncHealthState | null): Promise<void> {
    const state = await this.loadFullState();
    state.health = health;
    await this.plugin.saveData(this.mergeWithSettings(state));
  }

  async loadHealth(): Promise<SyncHealthState | null> {
    const state = await this.loadState();
    return state.health;
  }

  private async loadState(): Promise<
    Pick<StoredState, "baseline" | "conflicts" | "logs" | "preview" | "health">
  > {
    const raw: unknown = await this.plugin.loadData();
    const state = (raw ?? {}) as Partial<StoredState>;
    return {
      baseline: state.baseline ?? null,
      conflicts: state.conflicts ?? [],
      logs: state.logs ?? [],
      preview: state.preview ?? null,
      health: state.health ?? null,
    };
  }

  private async loadFullState(): Promise<StoredState> {
    const raw: unknown = await this.plugin.loadData();
    const state = (raw ?? {}) as Partial<StoredState>;
    const settings = this.extractSettings(raw);
    // Extract settings fields from top level (not nested under 'settings' key)
    return {
      ...(settings ? { settings } : {}),
      auth: extractGitHubAppAuthState(raw),
      baseline: state.baseline ?? null,
      conflicts: state.conflicts ?? [],
      logs: state.logs ?? [],
      preview: state.preview ?? null,
      health: state.health ?? null,
    };
  }

  private extractSettings(data: unknown) {
    return extractPluginSettings(data);
  }

  private mergeWithSettings(state: StoredState): Record<string, unknown> {
    const result: Record<string, unknown> = {
      auth: state.auth,
      baseline: state.baseline,
      conflicts: state.conflicts,
      logs: state.logs,
      preview: state.preview,
      health: state.health,
    };
    // Spread settings back to top level
    if (state.settings) {
      Object.assign(result, state.settings);
    }
    return result;
  }
}
