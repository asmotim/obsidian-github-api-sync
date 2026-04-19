import { describe, expect, it, vi, beforeEach } from "vitest";
import { GitHubApiClient } from "../src/clients/github-client";

// Mock obsidian module
vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

type MockResponse = {
  status: number;
  headers: Record<string, string>;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
};

const makeResponse = (options: {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}): MockResponse => {
  return {
    status: options.status,
    headers: options.headers ?? {},
    json: options.json ?? {},
    text: options.text ?? "",
    arrayBuffer: new ArrayBuffer(0),
  };
};

describe("GitHubApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries on 429", async () => {
    vi.useFakeTimers();
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValueOnce(
      makeResponse({ status: 429, headers: { "retry-after": "0" } })
    );
    requestUrlMock.mockResolvedValueOnce(
      makeResponse({ status: 200, json: { content: "Zg==", sha: "s" } })
    );

    const client = new GitHubApiClient("t", "o", "r");
    const promise = client.getFile("a.md", "main");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    expect(result.sha).toBe("s");
    vi.useRealTimers();
  });

  it("retries on rate limit 403", async () => {
    vi.useFakeTimers();
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValueOnce(
      makeResponse({
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" },
      })
    );
    requestUrlMock.mockResolvedValueOnce(makeResponse({ status: 200, json: { sha: "s" } }));

    const client = new GitHubApiClient("t", "o", "r");
    const promise = client.getCommitSha("main");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    expect(result).toBe("s");
    vi.useRealTimers();
  });

  it("does not retry on non-rate-limit 403", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValue(makeResponse({ status: 403, text: "forbidden" }));

    const client = new GitHubApiClient("t", "o", "r");
    await expect(client.getCommitSha("main")).rejects.toThrow("403");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 401", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValue(makeResponse({ status: 401, text: "unauthorized" }));

    const client = new GitHubApiClient("t", "o", "r");
    await expect(client.getFile("a.md", "main")).rejects.toThrow("401");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after refreshing credentials on 401", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);
    const onUnauthorized = vi.fn().mockResolvedValue("new-token");

    requestUrlMock.mockResolvedValueOnce(makeResponse({ status: 401, text: "unauthorized" }));
    requestUrlMock.mockResolvedValueOnce(
      makeResponse({ status: 200, json: { content: "Zg==", sha: "s" } })
    );

    const client = new GitHubApiClient("old-token", "o", "r", { onUnauthorized });
    const result = await client.getFile("a.md", "main");

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    expect(result.sha).toBe("s");
  });

  it("throws conflict error on 409", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValue(makeResponse({ status: 409, text: "conflict" }));

    const client = new GitHubApiClient("t", "o", "r");
    await expect(client.getCommitSha("main")).rejects.toThrow("409");
  });

  it("encodes path segments", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValue(makeResponse({ status: 200, json: { content: "Zg==", sha: "s" } }));

    const client = new GitHubApiClient("t", "o", "r");
    await client.getFile("folder/a b.md", "main");

    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    const firstCall = requestUrlMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected requestUrl to be called");
    }
    const callArgs = firstCall[0];
    expect(typeof callArgs).toBe("object");
    if (typeof callArgs === "string") {
      throw new Error("Expected RequestUrlParam object");
    }
    expect(callArgs.url).toContain("folder/a%20b.md");
  });

  it("reuses cached GET data when GitHub returns 304 with an ETag", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: { sha: "sha-1" },
          headers: { etag: '"etag-1"' },
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 304,
          headers: { etag: '"etag-1"' },
        })
      );

    const client = new GitHubApiClient("t", "o", "r");
    await expect(client.getCommitSha("main")).resolves.toBe("sha-1");
    await expect(client.getCommitSha("main")).resolves.toBe("sha-1");

    const secondCall = requestUrlMock.mock.calls[1];
    if (!secondCall) {
      throw new Error("Expected a second request");
    }
    const callArgs = secondCall[0];
    if (typeof callArgs === "string") {
      throw new Error("Expected RequestUrlParam object");
    }
    expect(callArgs.headers?.["If-None-Match"]).toBe('"etag-1"');
  });

  it("walks the tree recursively when GitHub truncates the recursive tree response", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: {
            truncated: true,
            tree: [],
          },
        })
      )
      .mockResolvedValueOnce(makeResponse({ status: 200, json: { sha: "commit-head" } }))
      .mockResolvedValueOnce(
        makeResponse({ status: 200, json: { tree: { sha: "tree-root" } } })
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: {
            tree: [
              { path: "note.md", sha: "blob-root", size: 1, type: "blob" },
              { path: "folder", sha: "tree-child", type: "tree" },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: {
            tree: [{ path: "nested.md", sha: "blob-child", size: 2, type: "blob" }],
          },
        })
      );

    const client = new GitHubApiClient("t", "o", "r");
    const result = await client.listTree("main");

    expect(result.truncated).toBe(true);
    expect(result.usedTruncatedTreeFallback).toBe(true);
    expect(result.index).toEqual({
      "folder/nested.md": {
        path: "folder/nested.md",
        sha: "blob-child",
        size: 2,
        lastCommitTime: 0,
      },
      "note.md": {
        path: "note.md",
        sha: "blob-root",
        size: 1,
        lastCommitTime: 0,
      },
    });
  });

  it("marks compare results as potentially incomplete when GitHub paginates them", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValue(
      makeResponse({
        status: 200,
        headers: {
          link: '<https://api.github.com/resource?page=2>; rel="next"',
        },
        json: {
          files: [{ filename: "note.md", status: "modified", sha: "sha-note" }],
          commits: [{ commit: { committer: { date: "2026-04-20T00:00:00.000Z" } } }],
          total_commits: 2,
        },
      })
    );

    const client = new GitHubApiClient("t", "o", "r");
    const result = await client.compareCommits("base", "head");

    expect(result.hasPagination).toBe(true);
    expect(result.fileListMayBeIncomplete).toBe(true);
    expect(result.totalCommits).toBe(2);
  });
});
