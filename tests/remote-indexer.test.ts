import { describe, expect, it, vi } from "vitest";
import { GitHubRemoteIndexer } from "../src/indexers/remote-indexer";
import type { RemoteIndex, SyncBaseline } from "../src/types/sync-types";

const listTreeResponse: RemoteIndex = {
  "a.md": { path: "a.md", sha: "s1", size: 1, lastCommitTime: 0 },
};

describe("GitHubRemoteIndexer", () => {
  it("falls back to listTree when baseline missing", async () => {
    const client = {
      listTree: vi.fn().mockResolvedValue({
        index: listTreeResponse,
        truncated: false,
        usedTruncatedTreeFallback: false,
      }),
      compareCommits: vi.fn(),
      getFile: vi.fn(),
    };

    const indexer = new GitHubRemoteIndexer(client as any);
    const result = await indexer.fetchIndex("o", "r", "main", null);

    expect(client.listTree).toHaveBeenCalledOnce();
    expect(result).toEqual(listTreeResponse);
  });

  it("limits index to configured repository subfolder", async () => {
    const client = {
      listTree: vi.fn().mockResolvedValue({
        index: {
          "vault/a.md": { path: "vault/a.md", sha: "s1", size: 1, lastCommitTime: 0 },
          "vault/10 Archive/.gitkeep": {
            path: "vault/10 Archive/.gitkeep",
            sha: "s-keep",
            size: 0,
            lastCommitTime: 0,
          },
          "docs/readme.md": { path: "docs/readme.md", sha: "s2", size: 1, lastCommitTime: 0 },
        },
        truncated: false,
        usedTruncatedTreeFallback: false,
      }),
      compareCommits: vi.fn(),
      getFile: vi.fn(),
    };

    const indexer = new GitHubRemoteIndexer(client as any);
    const result = await indexer.fetchIndex("o", "r", "main", null, "vault");

    expect(result).toEqual({
      "a.md": { path: "a.md", sha: "s1", size: 1, lastCommitTime: 0 },
    });
    expect(indexer.getLastFetchMeta()?.placeholderDirectories).toEqual(["10 Archive"]);
  });

  it("builds incremental index from baseline", async () => {
    const client = {
      listTree: vi.fn(),
      compareCommits: vi.fn().mockResolvedValue({
        files: [
          { filename: "changed.md", status: "modified" },
          { filename: "gone.md", status: "removed" },
          { filename: "new.md", status: "added" },
          { filename: "renamed.md", status: "renamed", previous_filename: "old.md" },
        ],
        headCommitDate: new Date(1_700_000_000_000).toISOString(),
        totalCommits: 1,
        hasPagination: false,
        fileListMayBeIncomplete: false,
      }),
      getFile: vi.fn().mockResolvedValue({ content: "", sha: "sha-new" }),
    };

    const baseline: SyncBaseline = {
      commitSha: "base",
      entries: {
        "changed.md": { path: "changed.md", sha: "sha-old" },
        "gone.md": { path: "gone.md", sha: "sha-gone" },
        "old.md": { path: "old.md", sha: "sha-old" },
      },
    };

    const indexer = new GitHubRemoteIndexer(client as any);
    const result = await indexer.fetchIndex("o", "r", "main", baseline);

    expect(client.listTree).not.toHaveBeenCalled();
    expect(client.compareCommits).toHaveBeenCalledOnce();
    expect(result["gone.md"]).toBeUndefined();
    expect(result["old.md"]).toBeUndefined();
    expect(result["new.md"]).toBeDefined();
    expect(result["changed.md"]?.sha).toBe("sha-new");
  });

  it("falls back to listTree when compare fails", async () => {
    const client = {
      listTree: vi.fn().mockResolvedValue({
        index: listTreeResponse,
        truncated: false,
        usedTruncatedTreeFallback: false,
      }),
      compareCommits: vi.fn().mockRejectedValue(new Error("boom")),
      getFile: vi.fn(),
    };

    const baseline: SyncBaseline = {
      commitSha: "base",
      entries: { "a.md": { path: "a.md", sha: "s1" } },
    };

    const indexer = new GitHubRemoteIndexer(client as any);
    const result = await indexer.fetchIndex("o", "r", "main", baseline);

    expect(client.listTree).toHaveBeenCalledOnce();
    expect(result).toEqual(listTreeResponse);
  });

  it("falls back to a full tree fetch when compare paging makes the changed-file list incomplete", async () => {
    const client = {
      listTree: vi.fn().mockResolvedValue({
        index: listTreeResponse,
        truncated: false,
        usedTruncatedTreeFallback: false,
      }),
      compareCommits: vi.fn().mockResolvedValue({
        files: [{ filename: "a.md", status: "modified" }],
        headCommitDate: new Date(1_700_000_000_000).toISOString(),
        totalCommits: 5,
        hasPagination: true,
        fileListMayBeIncomplete: true,
      }),
      getFile: vi.fn(),
    };

    const baseline: SyncBaseline = {
      commitSha: "base",
      entries: { "a.md": { path: "a.md", sha: "s1" } },
    };

    const indexer = new GitHubRemoteIndexer(client as any);
    const result = await indexer.fetchIndex("o", "r", "main", baseline);

    expect(client.compareCommits).toHaveBeenCalledOnce();
    expect(client.listTree).toHaveBeenCalledOnce();
    expect(result).toEqual(listTreeResponse);
    expect(indexer.getLastFetchMeta()?.usedFullFallback).toBe(true);
    expect(indexer.getLastFetchMeta()?.diagnostics.map((entry) => entry.code)).toContain(
      "remote_compare_file_cap"
    );
  });

  it("tracks placeholder directories from .gitkeep changes during incremental fetches", async () => {
    const client = {
      listTree: vi.fn(),
      compareCommits: vi.fn().mockResolvedValue({
        files: [
          { filename: "09 Attachments/PDFs/.gitkeep", status: "added" },
          { filename: "10 Archive/.gitkeep", status: "removed" },
        ],
        headCommitDate: new Date(1_700_000_000_000).toISOString(),
        totalCommits: 1,
        hasPagination: false,
        fileListMayBeIncomplete: false,
      }),
      getFile: vi.fn(),
    };

    const baseline: SyncBaseline = {
      commitSha: "base",
      entries: {},
      placeholderDirectories: ["10 Archive"],
    };

    const indexer = new GitHubRemoteIndexer(client as any);
    await indexer.fetchIndex("o", "r", "main", baseline);

    expect(indexer.getLastFetchMeta()?.placeholderDirectories).toEqual(["09 Attachments/PDFs"]);
  });
});
