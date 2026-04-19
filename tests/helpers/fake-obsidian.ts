import { normalizePath, TFile, TFolder } from "obsidian";

type Stored = {
  file: FakeTFile;
  data: Uint8Array;
};

export class FakeTFile extends TFile {
  override path: string;
  override stat: { ctime: number; mtime: number; size: number };

  constructor(path: string, data: Uint8Array) {
    super();
    this.path = path;
    this.stat = { ctime: Date.now(), mtime: Date.now(), size: data.length };
  }
}

export class FakeVault {
  files = new Map<string, Stored>();
  folders = new Set<string>();
  adapter = {
    list: async (path: string) => this.list(path),
    remove: async (path: string) => {
      this.files.delete(this.normalize(path));
    },
    rmdir: async (path: string, recursive: boolean) => {
      const normalized = this.normalize(path);
      const listing = await this.list(normalized);
      if (!recursive && (listing.files.length > 0 || listing.folders.length > 0)) {
        throw new Error(`Directory is not empty: ${normalized}`);
      }
      this.folders.delete(normalized);
    },
  };

  getFiles(): TFile[] {
    return Array.from(this.files.values()).map((entry) => entry.file);
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    const normalized = this.normalize(path);
    const stored = this.files.get(normalized);
    if (stored) {
      return stored.file;
    }

    if (this.folders.has(normalized)) {
      return new TFolder();
    }

    return null;
  }

  async readBinary(file: TFile): Promise<Uint8Array> {
    const entry = this.files.get((file as FakeTFile).path);
    return entry ? entry.data : new Uint8Array();
  }

  async createBinary(path: string, data: Uint8Array): Promise<void> {
    const normalized = this.normalize(path);
    this.ensureParentFolders(normalized);
    this.files.set(normalized, { file: new FakeTFile(normalized, data), data });
  }

  async modifyBinary(file: TFile, data: Uint8Array): Promise<void> {
    const path = (file as FakeTFile).path;
    if (this.files.has(path)) {
      this.files.set(path, { file: new FakeTFile(path, data), data });
    }
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete((file as FakeTFile).path);
  }

  async trashFile(file: TFile): Promise<void> {
    this.files.delete((file as FakeTFile).path);
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const path = (file as FakeTFile).path;
    const normalized = this.normalize(newPath);
    const entry = this.files.get(path);
    if (!entry) {
      return;
    }

    this.files.delete(path);
    this.ensureParentFolders(normalized);
    this.files.set(normalized, { file: new FakeTFile(normalized, entry.data), data: entry.data });
  }

  async createFolder(path: string): Promise<void> {
    const normalized = this.normalize(path);
    this.ensureParentFolders(normalized);
    this.folders.add(normalized);
  }

  private normalize(path: string): string {
    return normalizePath(path);
  }

  private ensureParentFolders(path: string): void {
    const segments = this.normalize(path).split("/").slice(0, -1);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.folders.add(current);
    }
  }

  private async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const normalized = path.trim().length > 0 ? this.normalize(path) : "";
    const files: string[] = [];
    const folders = new Set<string>();

    for (const filePath of this.files.keys()) {
      const relative = this.relativeToParent(filePath, normalized);
      if (relative === null) {
        continue;
      }

      if (relative.includes("/")) {
        folders.add(this.directChildPath(normalized, relative));
        continue;
      }

      files.push(filePath);
    }

    for (const folderPath of this.folders) {
      const relative = this.relativeToParent(folderPath, normalized);
      if (relative === null || relative.length === 0) {
        continue;
      }

      if (relative.includes("/")) {
        folders.add(this.directChildPath(normalized, relative));
        continue;
      }

      folders.add(folderPath);
    }

    return {
      files: files.sort(),
      folders: Array.from(folders).sort(),
    };
  }

  private relativeToParent(path: string, parent: string): string | null {
    if (parent === "") {
      return path;
    }

    if (path === parent) {
      return "";
    }

    if (!path.startsWith(`${parent}/`)) {
      return null;
    }

    return path.slice(parent.length + 1);
  }

  private directChildPath(parent: string, relativePath: string): string {
    const childSegment = relativePath.split("/")[0] ?? "";
    return parent ? `${parent}/${childSegment}` : childSegment;
  }
}

export class FakeApp {
  vault: FakeVault;
  fileManager: { trashFile: (file: TFile) => Promise<void> };

  constructor(vault: FakeVault) {
    this.vault = vault;
    this.fileManager = {
      trashFile: async (file: TFile) => {
        await this.vault.trashFile(file);
      },
    };
  }
}
