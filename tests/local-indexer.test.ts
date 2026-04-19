import { describe, expect, it } from "vitest";
import { LocalVaultIndexer } from "../src/indexers/local-indexer";
import { FakeApp, FakeVault } from "./helpers/fake-obsidian";

const toBuffer = (value: string) => Buffer.from(value, "utf8");

describe("LocalVaultIndexer", () => {
  it("indexes files under root", async () => {
    const vault = new FakeVault();
    await vault.createBinary("Journal/one.md", toBuffer("one"));
    await vault.createBinary("Other/two.md", toBuffer("two"));
    const app = new FakeApp(vault);
    const indexer = new LocalVaultIndexer(app as any);

    const index = await indexer.scan("Journal", []);
    expect(Object.keys(index)).toEqual(["Journal/one.md"]);
    expect(index["Journal/one.md"]?.hash).toBeDefined();
  });

  it("applies ignore patterns", async () => {
    const vault = new FakeVault();
    await vault.createBinary(".obsidian/config", toBuffer("x"));
    await vault.createBinary("note.md", toBuffer("y"));
    const app = new FakeApp(vault);
    const indexer = new LocalVaultIndexer(app as any);

    const index = await indexer.scan("", [".obsidian/"]);
    expect(Object.keys(index)).toEqual(["note.md"]);
  });

  it("supports wildcard ignore pattern", async () => {
    const vault = new FakeVault();
    await vault.createBinary("Journal/one.md", toBuffer("one"));
    await vault.createBinary("Journal/two.txt", toBuffer("two"));
    const app = new FakeApp(vault);
    const indexer = new LocalVaultIndexer(app as any);

    const index = await indexer.scan("", ["Journal/*.md"]);
    expect(Object.keys(index)).toEqual(["Journal/two.txt"]);
  });

  it("supports globstar ignore pattern", async () => {
    const vault = new FakeVault();
    await vault.createBinary("Journal/Archive/one.md", toBuffer("one"));
    await vault.createBinary("Journal/Archive/two.txt", toBuffer("two"));
    const app = new FakeApp(vault);
    const indexer = new LocalVaultIndexer(app as any);

    const index = await indexer.scan("", ["Journal/**/*.md"]);
    expect(Object.keys(index)).toEqual(["Journal/Archive/two.txt"]);
  });
});
