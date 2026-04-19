export type PluginSettings = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  persistToken: boolean;
  repoScopeMode: "fullRepo" | "subfolder";
  repoSubfolder: string;
  ignorePatterns: string[];
  conflictPolicy: "preferLocal" | "preferRemote" | "keepBoth" | "manual";
  syncIntervalMinutes: number | null;
  maxFileSizeMB: number;
};

export const DEFAULT_SETTINGS: PluginSettings = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  rootPath: "",
  persistToken: false,
  repoScopeMode: "fullRepo",
  repoSubfolder: "vault",
  ignorePatterns: [".git/"],
  conflictPolicy: "keepBoth",
  syncIntervalMinutes: null,
  maxFileSizeMB: 50, // GitHub API limit is 100MB, use 50MB as safe default
};

export const sanitizeSettingsForPersistence = (
  settings: PluginSettings
): PluginSettings => ({
  ...settings,
  token: settings.persistToken ? settings.token : "",
});
