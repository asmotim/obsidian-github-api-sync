export type SyncConfig = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  repoScopeMode: "fullRepo" | "subfolder";
  repoSubfolder: string;
  ignorePatterns: string[];
  conflictPolicy: "preferLocal" | "preferRemote" | "keepBoth" | "manual";
  syncIntervalMinutes?: number;
  maxFileSizeMB?: number;
  approvalKey?: string | null;
  authStatus?: string;
  onProgress?: (progress: SyncProgress) => void;
};

export type SyncProgress = {
  stage: "scanning" | "planning" | "executing" | "saving";
  message: string;
  current?: number;
  total?: number;
  percentage?: number;
};

export type BaselineEntry = {
  path: string;
  hash?: string;
  sha?: string;
  mtime?: number;
  size?: number;
  lastCommitTime?: number;
};

export type SyncBaseline = {
  commitSha?: string;
  entries: Record<string, BaselineEntry>;
  placeholderDirectories?: string[];
};

export type LocalEntry = {
  path: string;
  hash: string;
  mtime: number;
  size: number;
};

export type RemoteEntry = {
  path: string;
  sha: string;
  size: number;
  lastCommitTime: number;
};

export type LocalIndex = Record<string, LocalEntry>;
export type RemoteIndex = Record<string, RemoteEntry>;

export type SyncDiagnosticEntry = {
  code:
    | "remote_compare_failed"
    | "remote_compare_paged"
    | "remote_compare_file_cap"
    | "remote_tree_truncated"
    | "remote_tree_truncated_walk"
    | "mass_remote_delete_conflict"
    | "mass_delete_approval_required"
    | "preview_generated"
    | "baseline_repaired";
  level: "info" | "warn" | "error";
  message: string;
};

export type GitHubRateLimitSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  resource: string | null;
  retryAfterSeconds: number | null;
};

export type GitHubTreeResult = {
  index: RemoteIndex;
  truncated: boolean;
  usedTruncatedTreeFallback: boolean;
};

export type GitHubCompareFile = {
  filename: string;
  status: string;
  previous_filename?: string;
  sha?: string;
};

export type GitHubCompareResult = {
  files: GitHubCompareFile[];
  headCommitDate: string;
  totalCommits: number;
  hasPagination: boolean;
  fileListMayBeIncomplete: boolean;
};

export type RemoteIndexFetchMeta = {
  mode: "full" | "incremental";
  diagnostics: SyncDiagnosticEntry[];
  usedFullFallback: boolean;
  usedTruncatedTreeFallback: boolean;
  placeholderDirectories: string[];
};

export type SyncOp =
  | { type: "pull_new"; path: string }
  | { type: "pull_update"; path: string }
  | { type: "pull_delete"; path: string }
  | { type: "push_new"; path: string }
  | { type: "push_update"; path: string }
  | { type: "push_delete"; path: string }
  | { type: "rename_local"; from: string; to: string }
  | { type: "rename_remote"; from: string; to: string }
  | {
      type: "conflict";
      path: string;
      reason:
        | "modify-modify"
        | "delete-modify-local"
        | "delete-modify-remote"
        | "local-missing-remote"
        | "mass-remote-deletion-safety";
    };

export type ConflictRecord = {
  path: string;
  type: "modify-modify" | "delete-modify" | "safety";
  reason:
    | "modify-modify"
    | "delete-modify-local"
    | "delete-modify-remote"
    | "local-missing-remote"
    | "mass-remote-deletion-safety";
  localVersion?: { hash: string; mtime: number };
  remoteVersion?: { sha: string; lastCommitTime: number };
  policy: SyncConfig["conflictPolicy"];
  timestamp: string;
};

export type SyncLogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type SyncOpCounts = {
  pullNew: number;
  pullUpdate: number;
  pullDelete: number;
  pushNew: number;
  pushUpdate: number;
  pushDelete: number;
  renameLocal: number;
  renameRemote: number;
};

export type SyncPlanSummary = {
  localFileCount: number;
  remoteFileCount: number;
  baselineFileCount: number;
  conflictCount: number;
  counts: SyncOpCounts;
};

export type SyncApprovalRequirement = {
  required: boolean;
  key: string | null;
  reason: string | null;
  pullDeleteCount: number;
  deleteRatio: number;
  thresholdRatio: number;
};

export type SyncPreview = {
  generatedAt: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  repoScopeMode: "fullRepo" | "subfolder";
  repoSubfolder: string;
  summary: SyncPlanSummary;
  diagnostics: SyncDiagnosticEntry[];
  ops: SyncOp[];
  conflicts: ConflictRecord[];
  approval: SyncApprovalRequirement;
};

export type SyncHealthState = {
  updatedAt: string;
  lastAction: "sync" | "preview" | "repair-baseline";
  lastResult: "success" | "failed" | "blocked" | "preview" | "repaired";
  lastMessage: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  repoScopeMode: "fullRepo" | "subfolder";
  repoSubfolder: string;
  baselineEntryCount: number;
  previewApprovalRequired: boolean;
  previewApprovalKey: string | null;
  authStatus: string;
  diagnostics: SyncDiagnosticEntry[];
  rateLimit: GitHubRateLimitSnapshot | null;
};
