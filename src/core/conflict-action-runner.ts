import { normalizePath, TFile, type App } from "obsidian";
import type { ConflictRecord, SyncConfig } from "../types/sync-types";
import type { GitHubClient } from "../types/interfaces";

export type ConflictAction = "keepLocal" | "keepRemote" | "keepBoth";

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export class ConflictActionRunner {
  private app: App;
  private client: GitHubClient;

  constructor(app: App, client: GitHubClient) {
    this.app = app;
    this.client = client;
  }

  async resolve(record: ConflictRecord, action: ConflictAction, config: SyncConfig): Promise<void> {
    if (action === "keepLocal") {
      await this.applyPreferLocal(record, config);
      return;
    }

    if (action === "keepRemote") {
      await this.applyPreferRemote(record, config);
      return;
    }

    await this.applyKeepBoth(record, config);
  }

  private async applyPreferLocal(record: ConflictRecord, config: SyncConfig): Promise<void> {
    if (record.reason === "delete-modify-local" || record.reason === "local-missing-remote") {
      await this.deleteRemote(record.path, config);
      return;
    }

    await this.pushLocal(record.path, config);
  }

  private async applyPreferRemote(record: ConflictRecord, config: SyncConfig): Promise<void> {
    if (record.reason === "delete-modify-remote") {
      await this.deleteLocal(record.path);
      return;
    }

    await this.pullRemote(record.path, config);
  }

  private async applyKeepBoth(record: ConflictRecord, config: SyncConfig): Promise<void> {
    if (record.reason === "local-missing-remote") {
      await this.pullRemote(record.path, config);
      return;
    }
    const conflictPath = this.nextConflictPath(record.path, "conflict-manual");
    if (record.reason === "modify-modify") {
      await this.pullRemoteCopy(record.path, conflictPath, config);
      return;
    }

    if (record.reason === "delete-modify-local") {
      await this.pullRemoteCopy(record.path, conflictPath, config);
      return;
    }

    if (record.reason === "delete-modify-remote") {
      await this.copyLocal(record.path, conflictPath);
    }
  }

  private async pullRemote(path: string, config: SyncConfig): Promise<void> {
    const normalized = normalizePath(path);
    const { content } = await this.client.getFile(
      this.toRemotePath(normalized, config),
      config.branch
    );
    const buffer = Buffer.from(content, "base64");
    await this.ensureParentFolder(normalized);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing && existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, toArrayBuffer(buffer));
      return;
    }

    await this.app.vault.createBinary(normalized, toArrayBuffer(buffer));
  }

  private async pullRemoteCopy(path: string, targetPath: string, config: SyncConfig): Promise<void> {
    const normalized = normalizePath(path);
    const { content } = await this.client.getFile(
      this.toRemotePath(normalized, config),
      config.branch
    );
    const buffer = Buffer.from(content, "base64");
    await this.ensureParentFolder(targetPath);
    await this.app.vault.createBinary(targetPath, toArrayBuffer(buffer));
  }

  private async pushLocal(path: string, config: SyncConfig): Promise<void> {
    const normalized = normalizePath(path);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    const data = await this.app.vault.readBinary(abstractFile);
    const contentBase64 = Buffer.from(data).toString("base64");
    const remotePath = this.toRemotePath(normalized, config);
    let sha: string | undefined;
    try {
      const remote = await this.client.getFile(remotePath, config.branch);
      sha = remote.sha;
    } catch {
      sha = undefined;
    }

    await this.client.putFile(
      remotePath,
      contentBase64,
      `conflict: keep local ${path}`,
      sha,
      config.branch
    );
  }

  private async deleteLocal(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    await this.app.fileManager.trashFile(abstractFile);
  }

  private async deleteRemote(path: string, config: SyncConfig): Promise<void> {
    const remotePath = this.toRemotePath(path, config);
    let sha: string | undefined;
    try {
      const remote = await this.client.getFile(remotePath, config.branch);
      sha = remote.sha;
    } catch {
      sha = undefined;
    }

    if (!sha) {
      return;
    }

    await this.client.deleteFile(remotePath, `conflict: delete ${path}`, sha, config.branch);
  }

  private async copyLocal(sourcePath: string, targetPath: string): Promise<void> {
    const normalized = normalizePath(sourcePath);
    const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
    if (!abstractFile || !(abstractFile instanceof TFile)) {
      return;
    }

    const data = await this.app.vault.readBinary(abstractFile);
    await this.ensureParentFolder(targetPath);
    await this.app.vault.createBinary(targetPath, data);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (!parent) {
      return;
    }

    const existing = this.app.vault.getAbstractFileByPath(parent);
    if (existing) {
      return;
    }

    const segments = parent.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private nextConflictPath(path: string, tag: string): string {
    const normalized = normalizePath(path);
    const timestamp = this.formatTimestamp(new Date());
    const dotIndex = normalized.lastIndexOf(".");
    const hasExt = dotIndex > normalized.lastIndexOf("/");
    const base = hasExt ? normalized.slice(0, dotIndex) : normalized;
    const ext = hasExt ? normalized.slice(dotIndex) : "";
    let candidate = `${base} (${tag}-${timestamp})${ext}`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${base} (${tag}-${timestamp}-${counter})${ext}`;
      counter += 1;
    }
    return candidate;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}-${hours}${minutes}`;
  }

  private toRemotePath(localPath: string, config: SyncConfig): string {
    const normalizedPath = normalizePath(localPath);
    if (config.repoScopeMode !== "subfolder") {
      return normalizedPath;
    }
    const trimmedSubfolder = config.repoSubfolder.trim().replace(/^\/+|\/+$/g, "");
    const subfolder = trimmedSubfolder.length > 0 ? trimmedSubfolder : "vault";
    return `${subfolder}/${normalizedPath}`;
  }
}
