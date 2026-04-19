import { vi } from "vitest";

vi.mock("obsidian", () => {
  class TFile {}
  class TFolder {}
  class Notice {
    constructor(_message?: string) {}
  }
  class Modal {}
  class Plugin {}
  class App {}

  return {
    normalizePath: (value: string) => value.replace(/\\/g, "/"),
    TFile,
    TFolder,
    Notice,
    Modal,
    Plugin,
    App,
  };
});

Object.defineProperty(globalThis, "window", {
  value: {
  setTimeout: (handler: (...args: any[]) => void, timeout?: number, ...args: any[]) =>
    setTimeout(handler, timeout, ...args),
  clearTimeout: (handle: number) => clearTimeout(handle),
  } as unknown as Window,
  writable: true,
});

