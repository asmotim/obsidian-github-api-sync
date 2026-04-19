import { normalizePath, TFile, type App } from "obsidian";
import type { LocalIndex, SyncBaseline } from "../types/sync-types";
import type { LocalIndexer } from "../types/interfaces";

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

      if (this.isIgnored(file.path, ignorePatterns)) {
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
      console.warn(
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

  private isIgnored(path: string, ignorePatterns: string[]): boolean {
    if (ignorePatterns.length === 0) {
      return false;
    }

    const normalized = normalizePath(path);

    // Use internal glob matching for robust ignore pattern support
    for (const pattern of ignorePatterns) {
      const trimmed = pattern.trim();
      if (!trimmed) {
        continue;
      }

      // Handle directory patterns (ending with /)
      if (trimmed.endsWith("/")) {
        const dirPattern = normalizePath(trimmed);
        if (normalized.startsWith(dirPattern) || normalized === dirPattern.slice(0, -1)) {
          return true;
        }
      } else {
        if (this.matchesGlob(normalized, normalizePath(trimmed))) {
          return true;
        }
      }
    }

    return false;
  }

  private matchesGlob(path: string, pattern: string): boolean {
    const regex = this.globToRegExp(pattern);
    return regex.test(path);
  }

  private globToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const withGlobstar = escaped.replace(/\*\*/g, "__GLOBSTAR__");
    const withStar = withGlobstar.replace(/\*/g, "[^/]*");
    const withQuestion = withStar.replace(/\?/g, "[^/]");
    const source = withQuestion.replace(/__GLOBSTAR__/g, ".*");
    return new RegExp(`^${source}$`);
  }
}
