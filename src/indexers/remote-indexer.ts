import type {
  RemoteIndex,
  RemoteIndexFetchMeta,
  SyncBaseline,
  SyncDiagnosticEntry,
} from "../types/sync-types";
import type { RemoteIndexer } from "../types/interfaces";
import type { GitHubApiClient } from "../clients/github-client";

/**
 * Builds the remote sync index from GitHub while preferring incremental fetches.
 *
 * When GitHub's compare or tree APIs indicate that the changed-file view may be
 * incomplete, the indexer intentionally falls back to a full tree walk instead
 * of continuing with a partial remote picture.
 */
export class GitHubRemoteIndexer implements RemoteIndexer {
  private readonly client: GitHubApiClient;
  private lastFetchMeta: RemoteIndexFetchMeta | null = null;

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
      return this.fetchFullIndex(branch, repoSubfolder, []);
    }

    try {
      const incremental = await this.buildIncrementalIndex(branch, baseline, repoSubfolder);
      if (!incremental.fileListMayBeIncomplete) {
        this.lastFetchMeta = {
          mode: "incremental",
          diagnostics: incremental.diagnostics,
          usedFullFallback: false,
          usedTruncatedTreeFallback: false,
          placeholderDirectories: incremental.placeholderDirectories,
        };
        return incremental.index;
      }

      return this.fetchFullIndex(branch, repoSubfolder, incremental.diagnostics, true);
    } catch (error) {
      if (this.isEmptyRepoError(error)) {
        this.lastFetchMeta = {
          mode: "full",
          diagnostics: [],
          usedFullFallback: false,
          usedTruncatedTreeFallback: false,
          placeholderDirectories: baseline?.placeholderDirectories ?? [],
        };
        return {};
      }

      return this.fetchFullIndex(branch, repoSubfolder, [
        {
          code: "remote_compare_failed",
          level: "warn",
          message: "Incremental remote comparison failed. Falling back to a full remote tree fetch.",
        },
      ], true);
    }
  }

  async fetchDiff(baseSha: string, headSha: string): Promise<RemoteIndex> {
    void baseSha;
    const tree = await this.client.listTree(headSha);
    return tree.index;
  }

  getLastFetchMeta(): RemoteIndexFetchMeta | null {
    return this.lastFetchMeta;
  }

  private async fetchFullIndex(
    branch: string,
    repoSubfolder: string | undefined,
    diagnostics: SyncDiagnosticEntry[],
    usedFullFallback = false
  ): Promise<RemoteIndex> {
    try {
      const tree = await this.client.listTree(branch);
      const nextDiagnostics = [...diagnostics];
      const placeholderDirectories = this.extractPlaceholderDirectories(tree.index, repoSubfolder);
      if (tree.truncated) {
        nextDiagnostics.push({
          code: tree.usedTruncatedTreeFallback ? "remote_tree_truncated_walk" : "remote_tree_truncated",
          level: "warn",
          message: tree.usedTruncatedTreeFallback
            ? "The remote tree was truncated, so the plugin walked the repository tree in smaller requests."
            : "The remote tree response was truncated.",
        });
      }

      this.lastFetchMeta = {
        mode: "full",
        diagnostics: nextDiagnostics,
        usedFullFallback,
        usedTruncatedTreeFallback: tree.usedTruncatedTreeFallback,
        placeholderDirectories,
      };

      return this.filterToSubfolder(tree.index, repoSubfolder);
    } catch (error) {
      if (this.isEmptyRepoError(error)) {
        this.lastFetchMeta = {
          mode: "full",
          diagnostics,
          usedFullFallback,
          usedTruncatedTreeFallback: false,
          placeholderDirectories: [],
        };
        return {};
      }
      throw error;
    }
  }

  private async buildIncrementalIndex(
    branch: string,
    baseline: SyncBaseline,
    repoSubfolder?: string
  ): Promise<{
    index: RemoteIndex;
    diagnostics: SyncDiagnosticEntry[];
    fileListMayBeIncomplete: boolean;
    placeholderDirectories: string[];
  }> {
    const diagnostics: SyncDiagnosticEntry[] = [];
    const index: RemoteIndex = {};
    const placeholderDirectories = new Set<string>(baseline.placeholderDirectories ?? []);

    for (const [path, entry] of Object.entries(baseline.entries)) {
      if (!entry.sha) {
        continue;
      }
      index[path] = {
        path,
        sha: entry.sha,
        size: entry.size ?? 0,
        lastCommitTime: entry.lastCommitTime ?? 0,
      };
    }

    const comparison = await this.client.compareCommits(baseline.commitSha ?? "", branch);
    if (comparison.hasPagination) {
      diagnostics.push({
        code: "remote_compare_paged",
        level: "warn",
        message: "The compare endpoint indicates pagination, so the changed-file list may be incomplete.",
      });
    }

    if (comparison.fileListMayBeIncomplete) {
      diagnostics.push({
        code: "remote_compare_file_cap",
        level: "warn",
        message: "The compare endpoint may have hit GitHub's changed-file cap. Falling back to a full tree fetch.",
      });
      return {
        index,
        diagnostics,
        fileListMayBeIncomplete: true,
        placeholderDirectories: Array.from(placeholderDirectories).sort(),
      };
    }

    const time = Date.parse(comparison.headCommitDate);
    const commitTime = Number.isFinite(time) ? time : 0;

    for (const file of comparison.files) {
      if (this.placeholderDirectoryFromPath(file.filename, repoSubfolder)) {
        this.applyPlaceholderFileChange(placeholderDirectories, file, repoSubfolder);
        continue;
      }

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

      let sha = file.sha;
      if (!sha) {
        const info = await this.client.getFile(this.toRemotePath(filename, repoSubfolder), branch);
        sha = info.sha;
      }

      index[filename] = {
        path: filename,
        sha,
        size: 0,
        lastCommitTime: commitTime,
      };
    }

    return {
      index,
      diagnostics,
      fileListMayBeIncomplete: false,
      placeholderDirectories: Array.from(placeholderDirectories).sort(),
    };
  }

  private isEmptyRepoError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Git Repository is empty");
  }

  private filterToSubfolder(index: RemoteIndex, repoSubfolder?: string): RemoteIndex {
    if (!repoSubfolder) {
      return this.filterPlaceholderFiles(index);
    }

    const filtered: RemoteIndex = {};
    for (const [path, entry] of Object.entries(index)) {
      const stripped = this.stripSubfolder(path, repoSubfolder);
      if (!stripped || this.isPlaceholderPath(stripped)) {
        continue;
      }
      filtered[stripped] = {
        ...entry,
        path: stripped,
      };
    }
    return filtered;
  }

  private filterPlaceholderFiles(index: RemoteIndex): RemoteIndex {
    const filtered: RemoteIndex = {};
    for (const [path, entry] of Object.entries(index)) {
      if (this.isPlaceholderPath(path)) {
        continue;
      }
      filtered[path] = entry;
    }
    return filtered;
  }

  private extractPlaceholderDirectories(
    index: RemoteIndex,
    repoSubfolder?: string
  ): string[] {
    const directories = new Set<string>();

    for (const path of Object.keys(index)) {
      const stripped = this.stripSubfolder(path, repoSubfolder);
      if (!stripped || !this.isPlaceholderPath(stripped)) {
        continue;
      }

      const directory = stripped.slice(0, -"/.gitkeep".length);
      if (directory.length > 0) {
        directories.add(directory);
      }
    }

    return Array.from(directories).sort();
  }

  private applyPlaceholderFileChange(
    placeholderDirectories: Set<string>,
    file: { filename: string; status: string; previous_filename?: string },
    repoSubfolder?: string
  ): void {
    const directory = this.placeholderDirectoryFromPath(file.filename, repoSubfolder);
    const previousDirectory = file.previous_filename
      ? this.placeholderDirectoryFromPath(file.previous_filename, repoSubfolder)
      : null;

    if (file.status === "removed") {
      if (directory) {
        placeholderDirectories.delete(directory);
      }
      if (previousDirectory) {
        placeholderDirectories.delete(previousDirectory);
      }
      return;
    }

    if (file.status === "renamed" && previousDirectory) {
      placeholderDirectories.delete(previousDirectory);
    }

    if (directory) {
      placeholderDirectories.add(directory);
    }
  }

  private placeholderDirectoryFromPath(path: string, repoSubfolder?: string): string | null {
    const stripped = this.stripSubfolder(path, repoSubfolder);
    if (!stripped || !this.isPlaceholderPath(stripped)) {
      return null;
    }

    const directory = stripped.slice(0, -"/.gitkeep".length);
    return directory.length > 0 ? directory : null;
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

  private isPlaceholderPath(path: string): boolean {
    return path.endsWith("/.gitkeep");
  }
}
