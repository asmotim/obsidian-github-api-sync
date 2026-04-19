export type SyncConfig = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  ignorePatterns: string[];
  conflictPolicy: "preferLocal" | "preferRemote" | "keepBoth" | "manual";
  syncIntervalMinutes?: number;
  maxFileSizeMB?: number;
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
  type: "modify-modify" | "delete-modify";
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
