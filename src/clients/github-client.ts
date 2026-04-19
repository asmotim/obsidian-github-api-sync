import { requestUrl } from "obsidian";
import type { RemoteIndex } from "../types/sync-types";
import type { GitHubClient } from "../types/interfaces";

export class GitHubApiClient implements GitHubClient {
  private token: string;
  private owner: string;
  private repo: string;
  private baseUrl = "https://api.github.com";
  private maxRetries = 2;

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
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

  async listTree(ref: string): Promise<RemoteIndex> {
    const url = this.buildUrl(`/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(ref)}`, {
      recursive: "1",
    });
    const response = await this.request(url, { method: "GET" });
    const data = response.json as {
      tree: Array<{ path: string; sha: string; size?: number; type: string }>;
    };

    const index: RemoteIndex = {};
    for (const entry of data.tree) {
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
    return { private: data.private, permissions: data.permissions };
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

  async compareCommits(
    base: string,
    head: string
  ): Promise<{
    files: Array<{ filename: string; status: string; previous_filename?: string; sha?: string }>;
    headCommitDate: string;
  }> {
    if (!base || !head) {
      return { files: [], headCommitDate: new Date(0).toISOString() };
    }
    const url = this.buildUrl(
      `/repos/${this.owner}/${this.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
    );
    try {
      const response = await this.request(url, { method: "GET" });
      const data = response.json as {
        files?: Array<{ filename: string; status: string; previous_filename?: string; sha?: string }>;
        commits?: Array<{ commit?: { committer?: { date?: string } } }>;
      };

      const lastCommit =
        data.commits && data.commits.length > 0 ? data.commits[data.commits.length - 1] : null;
      return {
        files: data.files ?? [],
        headCommitDate: lastCommit?.commit?.committer?.date ?? new Date(0).toISOString(),
      };
    } catch (error) {
      if (this.isEmptyRepoError(error)) {
        return { files: [], headCommitDate: new Date(0).toISOString() };
      }
      throw error;
    }
  }

  private async request(url: string, init: { method: string; body?: string }): Promise<{
    status: number;
    json: unknown;
    headers: Record<string, string>;
  }> {
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      const response = await requestUrl({
        url,
        method: init.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: init.body,
      });

      if (response.status >= 200 && response.status < 300) {
        return {
          status: response.status,
          json: response.json,
          headers: response.headers,
        };
      }

      const shouldRetry = this.shouldRetry(response.status, response.headers, attempt);
      if (response.status === 409) {
        throw new Error(`GitHub API conflict (409): ${response.text}`);
      }

      if (!shouldRetry) {
        if (response.status === 401) {
          throw new Error(`GitHub authentication failed (401). Please check your token has the correct permissions (repo scope for private repositories).`);
        }
        throw new Error(`GitHub API error ${response.status}: ${response.text}`);
      }

      const delayMs = this.getRetryDelayMs(response.status, response.headers, attempt);
      await this.sleep(delayMs);
      attempt += 1;
    }

    throw new Error("GitHub API error: retry limit exceeded.");
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
