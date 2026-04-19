import { type TFile } from "obsidian";
import type {
  ConflictRecord,
  GitHubCompareResult,
  GitHubRateLimitSnapshot,
  GitHubTreeResult,
  LocalIndex,
  RemoteIndexFetchMeta,
  RemoteIndex,
  SyncBaseline,
  SyncConfig,
  SyncHealthState,
  SyncLogEntry,
  SyncOp,
  SyncPreview,
} from "./sync-types";

export interface LocalIndexer {
  scan(rootPath: string, ignorePatterns: string[]): Promise<LocalIndex>;
  computeHash(file: TFile): Promise<string>;
  setPreviousBaseline(baseline: SyncBaseline | null): void;
  setMaxFileSizeMB(maxSizeMB: number): void;
}

export interface RemoteIndexer {
  fetchIndex(
    owner: string,
    repo: string,
    branch: string,
    baseline?: SyncBaseline | null,
    repoSubfolder?: string
  ): Promise<RemoteIndex>;
  fetchDiff(baseSha: string, headSha: string): Promise<RemoteIndex>;
  getLastFetchMeta(): RemoteIndexFetchMeta | null;
}

export interface StateStore {
  loadBaseline(): Promise<SyncBaseline | null>;
  saveBaseline(baseline: SyncBaseline): Promise<void>;
  saveConflicts(records: ConflictRecord[]): Promise<void>;
  loadConflicts(): Promise<ConflictRecord[]>;
  appendLog(entry: SyncLogEntry): Promise<void>;
  loadLogs(): Promise<SyncLogEntry[]>;
  savePreview(preview: SyncPreview | null): Promise<void>;
  loadPreview(): Promise<SyncPreview | null>;
  saveHealth(health: SyncHealthState | null): Promise<void>;
  loadHealth(): Promise<SyncHealthState | null>;
}

export interface SyncPlanner {
  plan(
    local: LocalIndex,
    remote: RemoteIndex,
    baseline: SyncBaseline | null
  ): { ops: SyncOp[]; conflicts: SyncOp[] };
}

export interface ConflictResolver {
  resolve(
    conflicts: SyncOp[],
    policy: SyncConfig["conflictPolicy"]
  ): { resolvedOps: SyncOp[]; conflictRecords: ConflictRecord[] };
}

export interface GitHubClient {
  getFile(path: string, ref: string): Promise<{ content: string; sha: string }>;
  putFile(
    path: string,
    contentBase64: string,
    message: string,
    sha?: string,
    branch?: string
  ): Promise<void>;
  deleteFile(path: string, message: string, sha: string, branch?: string): Promise<void>;
  listTree(ref: string): Promise<GitHubTreeResult>;
  getCommitSha(branch: string): Promise<string>;
  getCommitInfo(branch: string): Promise<{ sha: string; date: string }>;
  compareCommits(base: string, head: string): Promise<GitHubCompareResult>;
  getRepoInfo(): Promise<{ private: boolean; permissions?: { push?: boolean; pull?: boolean } }>;
  getCommitTreeSha(commitSha: string): Promise<string>;
  createBlob(contentBase64: string): Promise<string>;
  createTree(options: {
    baseTreeSha?: string;
    entries: Array<{ path: string; sha: string | null; mode: string; type: "blob" }>;
  }): Promise<string>;
  createCommit(message: string, treeSha: string, parents: string[]): Promise<string>;
  updateRef(branch: string, commitSha: string): Promise<void>;
  getLastRateLimitSnapshot(): GitHubRateLimitSnapshot | null;
}

export interface SyncEngine {
  sync(config: SyncConfig): Promise<void>;
  preview(config: SyncConfig): Promise<SyncPreview>;
  repairBaseline(config: SyncConfig): Promise<SyncBaseline>;
}
