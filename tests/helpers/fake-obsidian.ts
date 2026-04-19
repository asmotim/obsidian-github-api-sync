import { TFile, TFolder } from "obsidian";

type Stored = {
  file: FakeTFile;
  data: Uint8Array;
};

export class FakeTFile extends TFile {
  path: string;
  stat: { ctime: number; mtime: number; size: number };

  constructor(path: string, data: Uint8Array) {
    super();
    this.path = path;
    this.stat = { ctime: Date.now(), mtime: Date.now(), size: data.length };
  }
}

export class FakeVault {
  files = new Map<string, Stored>();
  folders = new Set<string>();

  getFiles(): TFile[] {
    return Array.from(this.files.values()).map((entry) => entry.file);
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    const stored = this.files.get(path);
    if (stored) {
      return stored.file;
    }

    if (this.folders.has(path)) {
      return new TFolder();
    }

    return null;
  }

  async readBinary(file: TFile): Promise<Uint8Array> {
    const entry = this.files.get((file as FakeTFile).path);
    return entry ? entry.data : new Uint8Array();
  }

  async createBinary(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, { file: new FakeTFile(path, data), data });
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
    const entry = this.files.get(path);
    if (!entry) {
      return;
    }

    this.files.delete(path);
    this.files.set(newPath, { file: new FakeTFile(newPath, entry.data), data: entry.data });
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
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
