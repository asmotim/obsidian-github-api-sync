import { describe, expect, it, vi } from "vitest";
import { ConflictActionRunner } from "../src/core/conflict-action-runner";
import type { ConflictRecord } from "../src/types/sync-types";
import { FakeApp, FakeVault } from "./helpers/fake-obsidian";

const makeRecord = (reason: ConflictRecord["reason"]): ConflictRecord => ({
  path: "note.md",
  type: reason === "modify-modify" ? "modify-modify" : "delete-modify",
  reason,
  policy: "manual",
  timestamp: "now",
});

describe("ConflictActionRunner", () => {
  it("keepLocal deletes remote on delete-modify-local", async () => {
    const vault = new FakeVault();
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("delete-modify-local"), "keepLocal", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    expect(client.deleteFile).toHaveBeenCalledOnce();
  });

  it("keepLocal deletes remote on local-missing-remote", async () => {
    const vault = new FakeVault();
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("local-missing-remote"), "keepLocal", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    expect(client.deleteFile).toHaveBeenCalledOnce();
  });

  it("keepLocal pushes local on modify-modify", async () => {
    const vault = new FakeVault();
    await vault.createBinary("note.md", new Uint8Array([1]));
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockRejectedValue(new Error("not found")),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("modify-modify"), "keepLocal", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    expect(client.putFile).toHaveBeenCalledOnce();
  });

  it("keepRemote deletes local on delete-modify-remote", async () => {
    const vault = new FakeVault();
    await vault.createBinary("note.md", new Uint8Array([1]));
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("delete-modify-remote"), "keepRemote", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    expect(vault.getAbstractFileByPath("note.md")).toBeNull();
  });

  it("keepRemote restores remote on local-missing-remote", async () => {
    const vault = new FakeVault();
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("local-missing-remote"), "keepRemote", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    expect(vault.getAbstractFileByPath("note.md")).not.toBeNull();
  });

  it("keepBoth creates remote copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const vault = new FakeVault();
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("modify-modify"), "keepBoth", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    const entries = Array.from(vault.files.keys());
    const hasConflictCopy = entries.some(
      (path) => path.startsWith("note (conflict-manual-") && path.endsWith(").md")
    );
    expect(hasConflictCopy).toBe(true);
    vi.useRealTimers();
  });

  it("keepBoth increments name when conflict copy exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const vault = new FakeVault();
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    await vault.createBinary(`note (conflict-manual-${stamp}).md`, new Uint8Array([1]));
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("modify-modify"), "keepBoth", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "fullRepo",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    const entries = Array.from(vault.files.keys());
    const hasIncremented = entries.some((path) =>
      path.includes(`conflict-manual-${stamp}-1).md`)
    );
    expect(hasIncremented).toBe(true);
    vi.useRealTimers();
  });

  it("uses repository subfolder path when resolving remote actions", async () => {
    const vault = new FakeVault();
    await vault.createBinary("note.md", new Uint8Array([1]));
    const app = new FakeApp(vault);
    const client = {
      getFile: vi.fn().mockResolvedValue({ content: "Zg==", sha: "s" }),
      putFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    const runner = new ConflictActionRunner(app as any, client as any);
    await runner.resolve(makeRecord("modify-modify"), "keepLocal", {
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      rootPath: "",
      repoScopeMode: "subfolder",
      repoSubfolder: "vault",
      ignorePatterns: [],
      conflictPolicy: "manual",
    });

    expect(client.putFile).toHaveBeenCalledWith(
      "vault/note.md",
      expect.any(String),
      expect.any(String),
      "s",
      "main"
    );
  });
});
