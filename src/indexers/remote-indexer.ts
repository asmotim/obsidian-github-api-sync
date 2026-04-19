import type { RemoteIndex, SyncBaseline } from "../types/sync-types";
import type { RemoteIndexer } from "../types/interfaces";
import type { GitHubApiClient } from "../clients/github-client";

export class GitHubRemoteIndexer implements RemoteIndexer {
  private client: GitHubApiClient;

  constructor(client: GitHubApiClient) {
    this.client = client;
  }

  async fetchIndex(
    owner: string,
    repo: string,
    branch: string,
    baseline?: SyncBaseline | null,
    repoSubfolder?: string
  ): Promise<RemoteIndex> {
    void owner;
    void repo;
    if (!baseline?.commitSha) {
      try {
        const tree = await this.client.listTree(branch);
        return this.filterToSubfolder(tree, repoSubfolder);
      } catch (error) {
        if (this.isEmptyRepoError(error)) {
          return {};
        }
        throw error;
      }
    }

    try {
      return await this.buildIncrementalIndex(branch, baseline, repoSubfolder);
    } catch {
      const tree = await this.client.listTree(branch);
      return this.filterToSubfolder(tree, repoSubfolder);
    }
  }

  async fetchDiff(baseSha: string, headSha: string): Promise<RemoteIndex> {
    void baseSha;
    return this.client.listTree(headSha);
  }

  private async buildIncrementalIndex(
    branch: string,
    baseline: SyncBaseline,
    repoSubfolder?: string
  ): Promise<RemoteIndex> {
    const index: RemoteIndex = {};
    for (const [path, entry] of Object.entries(baseline.entries)) {
      if (entry.sha) {
        index[path] = {
          path,
          sha: entry.sha,
          size: 0,
          lastCommitTime: entry.lastCommitTime ?? 0,
        };
      }
    }

    const comparison = await this.client.compareCommits(baseline.commitSha ?? "", branch);
    const time = Date.parse(comparison.headCommitDate);
    const commitTime = Number.isFinite(time) ? time : 0;

    for (const file of comparison.files) {
      const filename = this.stripSubfolder(file.filename, repoSubfolder);
      const previousFilename = file.previous_filename
        ? this.stripSubfolder(file.previous_filename, repoSubfolder)
        : null;

      if (file.status === "removed") {
        if (filename) {
          delete index[filename];
        }
        if (previousFilename) {
          delete index[previousFilename];
        }
        continue;
      }

      if (file.status === "renamed" && previousFilename) {
        delete index[previousFilename];
      }

      if (!filename) {
        continue;
      }

      // Use SHA from compareCommits API if available, otherwise fetch file
      let sha: string;
      if (file.sha) {
        sha = file.sha;
      } else {
        const remoteFilePath = this.toRemotePath(filename, repoSubfolder);
        const info = await this.client.getFile(remoteFilePath, branch);
        sha = info.sha;
      }

      index[filename] = {
        path: filename,
        sha,
        size: 0,
        lastCommitTime: commitTime,
      };
    }

    return index;
  }

  private isEmptyRepoError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Git Repository is empty");
  }

  private filterToSubfolder(index: RemoteIndex, repoSubfolder?: string): RemoteIndex {
    if (!repoSubfolder) {
      return index;
    }
    const filtered: RemoteIndex = {};
    for (const [path, entry] of Object.entries(index)) {
      const stripped = this.stripSubfolder(path, repoSubfolder);
      if (!stripped) {
        continue;
      }
      filtered[stripped] = {
        ...entry,
        path: stripped,
      };
    }
    return filtered;
  }

  private stripSubfolder(path: string, repoSubfolder?: string): string | null {
    const prefix = this.normalizeRepoSubfolder(repoSubfolder);
    if (!prefix) {
      return path;
    }
    if (path === prefix) {
      return "";
    }
    if (!path.startsWith(`${prefix}/`)) {
      return null;
    }
    return path.slice(prefix.length + 1);
  }

  private toRemotePath(path: string, repoSubfolder?: string): string {
    const prefix = this.normalizeRepoSubfolder(repoSubfolder);
    return prefix ? `${prefix}/${path}` : path;
  }

  private normalizeRepoSubfolder(repoSubfolder?: string): string {
    if (!repoSubfolder) {
      return "";
    }
    return repoSubfolder.replace(/^\/+|\/+$/g, "");
  }
}
