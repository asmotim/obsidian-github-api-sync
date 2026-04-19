import { requestUrl } from "obsidian";
import type {
  GitHubCompareResult,
  GitHubRateLimitSnapshot,
  GitHubTreeResult,
  RemoteIndex,
} from "../types/sync-types";
import type { GitHubClient } from "../types/interfaces";

type GitHubApiClientOptions = {
  onUnauthorized?: () => Promise<string | null>;
};

type GitHubTreeApiEntry = {
  path: string;
  sha: string;
  size?: number;
  type: string;
};

type GitHubTreeApiResponse = {
  tree?: GitHubTreeApiEntry[];
  truncated?: boolean;
};

type GitHubCompareApiResponse = {
  files?: Array<{ filename: string; status: string; previous_filename?: string; sha?: string }>;
  commits?: Array<{ commit?: { committer?: { date?: string } } }>;
  total_commits?: number;
};

type ResponsePayload = {
  status: number;
  json: unknown;
  headers: Record<string, string>;
  text: string;
};

type CachedGetResponse = ResponsePayload & {
  etag: string;
};

/**
 * Browser-safe GitHub REST client for Obsidian runtime code.
 *
 * It keeps request construction explicit, reuses conditional GETs where safe,
 * captures rate-limit snapshots for health reporting, and throttles mutating
 * requests so sync bursts stay closer to GitHub's REST best practices.
 */
export class GitHubApiClient implements GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;
  private readonly baseUrl = "https://api.github.com";
  private readonly maxRetries = 2;
  private readonly onUnauthorized: (() => Promise<string | null>) | undefined;
  private readonly etagCache = new Map<string, CachedGetResponse>();
  private lastRateLimitSnapshot: GitHubRateLimitSnapshot | null = null;
  private lastMutationAt = 0;

  constructor(token: string, owner: string, repo: string, options: GitHubApiClientOptions = {}) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.onUnauthorized = options.onUnauthorized;
  }

  async getFile(path: string, ref: string): Promise<{ content: string; sha: string }> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/contents/${this.encodePath(path)}`, {
      ref,
    });
    const response = await this.request(url, { method: "GET" });
    const data = response.json as { content: string; sha: string };
    return { content: data.content.replace(/\n/g, ""), sha: data.sha };
  }

  async putFile(
    path: string,
    contentBase64: string,
    message: string,
    sha?: string,
    branch?: string
  ): Promise<void> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/contents/${this.encodePath(path)}`);
    await this.request(url, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: contentBase64,
        sha,
        branch,
      }),
    });
  }

  async deleteFile(path: string, message: string, sha: string, branch?: string): Promise<void> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/contents/${this.encodePath(path)}`);
    await this.request(url, {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch }),
    });
  }

  async listTree(ref: string): Promise<GitHubTreeResult> {
    const response = await this.fetchTree(ref, true);
    if (!response.truncated) {
      return {
        index: this.buildIndexFromTreeEntries(response.tree ?? []),
        truncated: false,
        usedTruncatedTreeFallback: false,
      };
    }

    const commitSha = await this.getCommitSha(ref);
    const rootTreeSha = await this.getCommitTreeSha(commitSha);
    const walkedIndex = await this.walkTree(rootTreeSha, "");
    return {
      index: walkedIndex,
      truncated: true,
      usedTruncatedTreeFallback: true,
    };
  }

  async getCommitSha(branch: string): Promise<string> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(branch)}`);
    const response = await this.request(url, { method: "GET" });
    const data = response.json as { sha: string };
    return data.sha;
  }

  async getCommitInfo(branch: string): Promise<{ sha: string; date: string }> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(branch)}`);
    try {
      const response = await this.request(url, { method: "GET" });
      const data = response.json as {
        sha: string;
        commit: { committer?: { date?: string } };
      };
      return {
        sha: data.sha,
        date: data.commit.committer?.date ?? new Date(0).toISOString(),
      };
    } catch (error) {
      if (this.isEmptyRepoError(error)) {
        return { sha: "", date: new Date(0).toISOString() };
      }
      throw error;
    }
  }

  async compareCommits(base: string, head: string): Promise<GitHubCompareResult> {
    if (!base || !head) {
      return {
        files: [],
        headCommitDate: new Date(0).toISOString(),
        totalCommits: 0,
        hasPagination: false,
        fileListMayBeIncomplete: false,
      };
    }

    const url = this.buildUrl(
      `/repos/${this.owner}/${this.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
    );
    try {
      const response = await this.request(url, { method: "GET" });
      const data = response.json as GitHubCompareApiResponse;
      const lastCommit =
        data.commits && data.commits.length > 0 ? data.commits[data.commits.length - 1] : null;
      const hasPagination = this.hasNextPage(response.headers);
      const files = data.files ?? [];
      return {
        files,
        headCommitDate: lastCommit?.commit?.committer?.date ?? new Date(0).toISOString(),
        totalCommits: data.total_commits ?? data.commits?.length ?? 0,
        hasPagination,
        fileListMayBeIncomplete: hasPagination || files.length >= 300,
      };
    } catch (error) {
      if (this.isEmptyRepoError(error)) {
        return {
          files: [],
          headCommitDate: new Date(0).toISOString(),
          totalCommits: 0,
          hasPagination: false,
          fileListMayBeIncomplete: false,
        };
      }
      throw error;
    }
  }

  async getRepoInfo(): Promise<{
    private: boolean;
    permissions?: { push?: boolean; pull?: boolean };
  }> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}`);
    const response = await this.request(url, { method: "GET" });
    const data = response.json as {
      private: boolean;
      permissions?: { push?: boolean; pull?: boolean };
    };
    return data.permissions
      ? { private: data.private, permissions: data.permissions }
      : { private: data.private };
  }

  async getCommitTreeSha(commitSha: string): Promise<string> {
    if (!commitSha) {
      return "";
    }
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/commits/${encodeURIComponent(commitSha)}`);
    const response = await this.request(url, { method: "GET" });
    const data = response.json as { tree: { sha: string } };
    return data.tree.sha;
  }

  async createBlob(contentBase64: string): Promise<string> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/blobs`);
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({ content: contentBase64, encoding: "base64" }),
    });
    const data = response.json as { sha: string };
    return data.sha;
  }

  async createTree(options: {
    baseTreeSha?: string;
    entries: Array<{ path: string; sha: string | null; mode: string; type: "blob" }>;
  }): Promise<string> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/trees`);
    const body: Record<string, unknown> = {
      tree: options.entries,
    };
    if (options.baseTreeSha) {
      body.base_tree = options.baseTreeSha;
    }
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = response.json as { sha: string };
    return data.sha;
  }

  async createCommit(message: string, treeSha: string, parents: string[]): Promise<string> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/commits`);
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({ message, tree: treeSha, parents }),
    });
    const data = response.json as { sha: string };
    return data.sha;
  }

  async updateRef(branch: string, commitSha: string): Promise<void> {
    const ref = `heads/${branch}`;
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/refs/${encodeURIComponent(ref)}`);
    try {
      await this.request(url, {
        method: "PATCH",
        body: JSON.stringify({ sha: commitSha, force: false }),
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("404")) {
        throw error;
      }
    }

    const createUrl = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/refs`);
    await this.request(createUrl, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
    });
  }

  getLastRateLimitSnapshot(): GitHubRateLimitSnapshot | null {
    return this.lastRateLimitSnapshot;
  }

  private async fetchTree(ref: string, recursive: boolean): Promise<GitHubTreeApiResponse> {
    const query = recursive ? { recursive: "1" } : undefined;
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(ref)}`, query);
    const response = await this.request(url, { method: "GET" });
    return response.json as GitHubTreeApiResponse;
  }

  private async walkTree(treeSha: string, prefix: string): Promise<RemoteIndex> {
    if (!treeSha) {
      return {};
    }

    const response = await this.fetchTree(treeSha, false);
    const index: RemoteIndex = {};

    for (const entry of response.tree ?? []) {
      if (entry.type === "blob") {
        const path = prefix ? `${prefix}${entry.path}` : entry.path;
        index[path] = {
          path,
          sha: entry.sha,
          size: entry.size ?? 0,
          lastCommitTime: 0,
        };
        continue;
      }

      if (entry.type !== "tree") {
        continue;
      }

      const childPrefix = prefix ? `${prefix}${entry.path}/` : `${entry.path}/`;
      const childIndex = await this.walkTree(entry.sha, childPrefix);
      Object.assign(index, childIndex);
    }

    return index;
  }

  private buildIndexFromTreeEntries(entries: GitHubTreeApiEntry[]): RemoteIndex {
    const index: RemoteIndex = {};
    for (const entry of entries) {
      if (entry.type !== "blob") {
        continue;
      }

      index[entry.path] = {
        path: entry.path,
        sha: entry.sha,
        size: entry.size ?? 0,
        lastCommitTime: 0,
      };
    }
    return index;
  }

  private async request(
    url: string,
    init: { method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; body?: string }
  ): Promise<ResponsePayload> {
    let attempt = 0;
    let unauthorizedRefreshAttempted = false;

    while (attempt <= this.maxRetries) {
      if (this.isMutativeRequest(init.method)) {
        await this.waitForMutationSlot();
      }

      const cachedGet = init.method === "GET" ? this.etagCache.get(url) : undefined;
      const request = {
        url,
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(cachedGet ? { "If-None-Match": cachedGet.etag } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      };
      const response = await requestUrl(request);

      this.captureRateLimitSnapshot(response.headers);

      if (response.status === 304 && cachedGet) {
        return {
          status: cachedGet.status,
          json: cachedGet.json,
          headers: {
            ...cachedGet.headers,
            ...response.headers,
          },
          text: cachedGet.text,
        };
      }

      if (response.status >= 200 && response.status < 300) {
        const payload: ResponsePayload = {
          status: response.status,
          json: response.json,
          headers: response.headers,
          text: response.text,
        };
        if (this.isMutativeRequest(init.method)) {
          this.lastMutationAt = Date.now();
        }
        this.storeEtagCache(url, payload);
        return payload;
      }

      const shouldRetry = this.shouldRetry(response.status, response.headers, attempt);
      if (response.status === 409) {
        throw new Error(`GitHub API conflict (409): ${response.text}`);
      }

      if (response.status === 401 && this.onUnauthorized && !unauthorizedRefreshAttempted) {
        unauthorizedRefreshAttempted = true;
        const refreshedToken = await this.onUnauthorized();
        if (refreshedToken) {
          this.token = refreshedToken;
          continue;
        }
      }

      if (!shouldRetry) {
        if (response.status === 401) {
          throw new Error(
            "GitHub authentication failed (401). Please reconnect the shared GitHub App and verify that it still has access to the target repository."
          );
        }
        throw new Error(`GitHub API error ${response.status}: ${response.text}`);
      }

      const delayMs = this.getRetryDelayMs(response.status, response.headers, attempt);
      await this.sleep(delayMs);
      attempt += 1;
    }

    throw new Error("GitHub API error: retry limit exceeded.");
  }

  private storeEtagCache(url: string, response: ResponsePayload): void {
    const etag = this.getHeader(response.headers, "etag");
    if (!etag || response.status < 200 || response.status >= 300) {
      return;
    }

    this.etagCache.set(url, {
      ...response,
      etag,
    });
  }

  private captureRateLimitSnapshot(headers: Record<string, string>): void {
    const limit = this.parseHeaderNumber(headers, "x-ratelimit-limit");
    const remaining = this.parseHeaderNumber(headers, "x-ratelimit-remaining");
    const reset = this.parseHeaderNumber(headers, "x-ratelimit-reset");
    const retryAfterSeconds = this.parseHeaderNumber(headers, "retry-after");

    this.lastRateLimitSnapshot = {
      limit,
      remaining,
      resetAt: Number.isFinite(reset) && reset !== null ? new Date(reset * 1000).toISOString() : null,
      resource: this.getHeader(headers, "x-ratelimit-resource") ?? null,
      retryAfterSeconds,
    };
  }

  private async waitForMutationSlot(): Promise<void> {
    const elapsedMs = Date.now() - this.lastMutationAt;
    if (elapsedMs >= 1000) {
      return;
    }
    await this.sleep(1000 - elapsedMs);
  }

  private isMutativeRequest(method: string): boolean {
    return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private encodePath(path: string): string {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  private shouldRetry(status: number, headers: Record<string, string>, attempt: number): boolean {
    if (attempt >= this.maxRetries) {
      return false;
    }

    if (status === 401 || status === 404) {
      return false;
    }

    if ([429, 500, 502, 503, 504].includes(status)) {
      return true;
    }

    if (status === 403) {
      const remaining = this.getHeader(headers, "x-ratelimit-remaining");
      const retryAfter = this.getHeader(headers, "retry-after");
      return remaining === "0" || Boolean(retryAfter);
    }

    return false;
  }

  private getRetryDelayMs(
    status: number,
    headers: Record<string, string>,
    attempt: number
  ): number {
    const retryAfter = this.getHeader(headers, "retry-after");
    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.min(retryAfterSeconds * 1000, 30_000);
      }
    }

    if (status === 403) {
      const resetRaw = this.getHeader(headers, "x-ratelimit-reset");
      if (resetRaw) {
        const resetSeconds = Number(resetRaw);
        if (Number.isFinite(resetSeconds)) {
          const untilResetMs = Math.max(0, resetSeconds * 1000 - Date.now());
          if (untilResetMs > 0) {
            return Math.min(untilResetMs, 30_000);
          }
        }
      }
    }

    const base = 500 * Math.pow(2, attempt);
    return Math.min(base, 5000);
  }

  private hasNextPage(headers: Record<string, string>): boolean {
    const link = this.getHeader(headers, "link");
    return typeof link === "string" && link.includes('rel="next"');
  }

  private parseHeaderNumber(headers: Record<string, string>, key: string): number | null {
    const raw = this.getHeader(headers, key);
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private isEmptyRepoError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Git Repository is empty");
  }

  private getHeader(headers: Record<string, string>, key: string): string | undefined {
    const lowerKey = key.toLowerCase();
    for (const [headerKey, value] of Object.entries(headers)) {
      if (headerKey.toLowerCase() === lowerKey) {
        return value;
      }
    }
    return undefined;
  }
}
