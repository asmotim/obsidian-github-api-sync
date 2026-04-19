import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  extractPluginSettings,
  sanitizeSettingsForPersistence,
} from "../src/types/plugin-settings";

describe("plugin settings", () => {
  it("persists settings without adding auth secrets to top-level settings", () => {
    const sanitized = sanitizeSettingsForPersistence({
      ...DEFAULT_SETTINGS,
    });

    expect(sanitized).toEqual(DEFAULT_SETTINGS);
  });

  it("extracts plugin settings without leaking unrelated state into settings", () => {
    const extracted = extractPluginSettings({
      owner: "tim",
      repo: "repo",
      auth: {
        provider: "githubApp",
      },
      baseline: {
        commitSha: "base",
      },
    });

    expect(extracted).toMatchObject({
      owner: "tim",
      repo: "repo",
    });
    expect(extracted).not.toHaveProperty("auth");
    expect(extracted).not.toHaveProperty("baseline");
  });

  it("ignores legacy auth fields that should no longer affect settings", () => {
    const extracted = extractPluginSettings({
      authMode: "pat",
      token: "legacy-token",
      persistToken: true,
      githubAppClientId: "custom-client-id",
      githubAppInstallUrl: "https://example.com/custom-install",
      owner: "tim",
    });

    expect(extracted).toMatchObject({
      owner: "tim",
      branch: DEFAULT_SETTINGS.branch,
      repoScopeMode: DEFAULT_SETTINGS.repoScopeMode,
    });
    expect(extracted).not.toHaveProperty("authMode");
    expect(extracted).not.toHaveProperty("token");
    expect(extracted).not.toHaveProperty("persistToken");
    expect(extracted).not.toHaveProperty("githubAppClientId");
    expect(extracted).not.toHaveProperty("githubAppInstallUrl");
  });
});
