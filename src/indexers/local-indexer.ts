import { normalizePath, type App, type TFile } from "obsidian";
import type { LocalIndex, SyncBaseline } from "../types/sync-types";
import type { LocalIndexer } from "../types/interfaces";
import { isIgnoredPath } from "../utils/path-filter";
import { runtimeLog } from "../utils/runtime-log";

export class LocalVaultIndexer implements LocalIndexer {
  private app: App;
  private previousBaseline: SyncBaseline | null = null;
  private maxFileSizeBytes: number = 50 * 1024 * 1024; // 50MB default

  constructor(app: App) {
    this.app = app;
  }

  setPreviousBaseline(baseline: SyncBaseline | null): void {
    this.previousBaseline = baseline;
  }

  setMaxFileSizeMB(maxSizeMB: number): void {
    this.maxFileSizeBytes = maxSizeMB * 1024 * 1024;
  }

  async scan(rootPath: string, ignorePatterns: string[]): Promise<LocalIndex> {
    const normalizedRoot = rootPath.trim() === "" ? "" : normalizePath(rootPath);
    const files = this.app.vault.getFiles();
    const index: LocalIndex = {};
    const skippedFiles: string[] = [];

    for (const file of files) {
      if (!this.isUnderRoot(file, normalizedRoot)) {
        continue;
      }

      if (isIgnoredPath(file.path, ignorePatterns)) {
        continue;
      }

      // Check file size
      if (file.stat.size > this.maxFileSizeBytes) {
        skippedFiles.push(file.path);
        continue;
      }

      const hash = await this.computeHashOptimized(file);
      index[file.path] = {
        path: file.path,
        hash,
        mtime: file.stat.mtime,
        size: file.stat.size,
      };
    }

    if (skippedFiles.length > 0) {
      runtimeLog.warn(
        `Skipped ${skippedFiles.length} large file(s) exceeding ${(this.maxFileSizeBytes / 1024 / 1024).toFixed(0)}MB.`
      );
    }

    return index;
  }

  private async computeHashOptimized(file: TFile): Promise<string> {
    // Check if we can reuse cached hash from baseline
    const baseEntry = this.previousBaseline?.entries[file.path];
    if (baseEntry?.hash && baseEntry.mtime === file.stat.mtime && baseEntry.size === file.stat.size) {
      // File unchanged based on mtime and size, reuse cached hash
      return baseEntry.hash;
    }

    // File is new or changed, compute hash
    return this.computeHash(file);
  }

  async computeHash(file: TFile): Promise<string> {
    const data = await this.app.vault.readBinary(file);
    const buffer = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  }

  private isUnderRoot(file: TFile, rootPath: string): boolean {
    if (rootPath === "") {
      return true;
    }

    const normalized = normalizePath(file.path);
    if (normalized === rootPath) {
      return true;
    }

    return normalized.startsWith(`${rootPath}/`);
  }
}
