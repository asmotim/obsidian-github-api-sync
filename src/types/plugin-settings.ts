/**
 * Persisted user-facing sync settings. Auth tokens and other volatile state
 * are intentionally stored elsewhere so settings remain safe to rewrite.
 */
export type PluginSettings = {
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  repoScopeMode: "fullRepo" | "subfolder";
  repoSubfolder: string;
  ignorePatterns: string[];
  conflictPolicy: "preferLocal" | "preferRemote" | "keepBoth" | "manual";
  syncIntervalMinutes: number | null;
  maxFileSizeMB: number;
};

/**
 * Default sync settings for new installations and for missing legacy fields.
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  owner: "",
  repo: "",
  branch: "main",
  rootPath: "",
  repoScopeMode: "fullRepo",
  repoSubfolder: "vault",
  ignorePatterns: [".git/"],
  conflictPolicy: "keepBoth",
  syncIntervalMinutes: null,
  maxFileSizeMB: 50, // GitHub API limit is 100MB, use 50MB as safe default
};

/**
 * Returns the settings payload that is safe to persist back into plugin data.
 * This intentionally excludes auth/session state, previews, logs, and baseline
 * data because those live in separate storage surfaces.
 */
export const sanitizeSettingsForPersistence = (
  settings: PluginSettings
): PluginSettings => ({
  ...settings,
});

const isRepoScopeMode = (value: unknown): value is PluginSettings["repoScopeMode"] =>
  value === "fullRepo" || value === "subfolder";

const isConflictPolicy = (value: unknown): value is PluginSettings["conflictPolicy"] =>
  value === "preferLocal" || value === "preferRemote" || value === "keepBoth" || value === "manual";

/**
 * Extracts the supported settings shape from raw plugin storage while keeping
 * backwards compatibility with older PAT-era payloads.
 */
export const extractPluginSettings = (data: unknown): PluginSettings | undefined => {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const obj = data as Record<string, unknown>;
  const hasSettings =
    "owner" in obj ||
    "repo" in obj ||
    "branch" in obj ||
    "rootPath" in obj ||
    "repoScopeMode" in obj ||
    "repoSubfolder" in obj ||
    "ignorePatterns" in obj ||
    "conflictPolicy" in obj ||
    "syncIntervalMinutes" in obj ||
    "maxFileSizeMB" in obj ||
    // Accept legacy auth fields so older plugin data still loads current defaults.
    "authMode" in obj ||
    "token" in obj ||
    "persistToken" in obj ||
    "githubAppClientId" in obj ||
    "githubAppInstallUrl" in obj;

  if (!hasSettings) {
    return undefined;
  }

  return {
    owner: typeof obj.owner === "string" ? obj.owner : DEFAULT_SETTINGS.owner,
    repo: typeof obj.repo === "string" ? obj.repo : DEFAULT_SETTINGS.repo,
    branch: typeof obj.branch === "string" ? obj.branch : DEFAULT_SETTINGS.branch,
    rootPath: typeof obj.rootPath === "string" ? obj.rootPath : DEFAULT_SETTINGS.rootPath,
    repoScopeMode: isRepoScopeMode(obj.repoScopeMode) ? obj.repoScopeMode : DEFAULT_SETTINGS.repoScopeMode,
    repoSubfolder: typeof obj.repoSubfolder === "string" ? obj.repoSubfolder : DEFAULT_SETTINGS.repoSubfolder,
    ignorePatterns: Array.isArray(obj.ignorePatterns)
      ? obj.ignorePatterns.filter((entry): entry is string => typeof entry === "string")
      : DEFAULT_SETTINGS.ignorePatterns,
    conflictPolicy: isConflictPolicy(obj.conflictPolicy) ? obj.conflictPolicy : DEFAULT_SETTINGS.conflictPolicy,
    syncIntervalMinutes:
      typeof obj.syncIntervalMinutes === "number" || obj.syncIntervalMinutes === null
        ? obj.syncIntervalMinutes
        : DEFAULT_SETTINGS.syncIntervalMinutes,
    maxFileSizeMB: typeof obj.maxFileSizeMB === "number" ? obj.maxFileSizeMB : DEFAULT_SETTINGS.maxFileSizeMB,
  };
};
