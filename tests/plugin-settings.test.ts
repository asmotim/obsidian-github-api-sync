import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettingsForPersistence } from "../src/types/plugin-settings";

describe("plugin settings secret handling", () => {
  it("does not persist token by default", () => {
    const sanitized = sanitizeSettingsForPersistence({
      ...DEFAULT_SETTINGS,
      token: "secret-token",
      persistToken: false,
    });

    expect(sanitized.token).toBe("");
  });

  it("persists token only when explicitly enabled", () => {
    const sanitized = sanitizeSettingsForPersistence({
      ...DEFAULT_SETTINGS,
      token: "secret-token",
      persistToken: true,
    });

    expect(sanitized.token).toBe("secret-token");
  });
});
