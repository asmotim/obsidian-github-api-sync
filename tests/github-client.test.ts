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

  it("does not retry on 401", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);

    requestUrlMock.mockResolvedValue(makeResponse({ status: 401, text: "unauthorized" }));

    const client = new GitHubApiClient("t", "o", "r");
    await expect(client.getFile("a.md", "main")).rejects.toThrow("401");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
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
    const callArgs = requestUrlMock.mock.calls[0][0];
    expect(typeof callArgs).toBe("object");
    if (typeof callArgs === "string") {
      throw new Error("Expected RequestUrlParam object");
    }
    expect(callArgs.url).toContain("folder/a%20b.md");
  });
});
