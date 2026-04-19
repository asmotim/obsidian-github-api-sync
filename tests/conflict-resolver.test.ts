import { describe, expect, it } from "vitest";
import { DefaultConflictResolver } from "../src/core/conflict-resolver";
import type { SyncOp } from "../src/types/sync-types";

const resolver = new DefaultConflictResolver();

const conflict = (reason: Extract<SyncOp, { type: "conflict" }>["reason"]): SyncOp => ({
  type: "conflict",
  path: "note.md",
  reason,
});

describe("DefaultConflictResolver", () => {
  it("resolves preferLocal", async () => {
    const { resolvedOps, conflictRecords } = resolver.resolve(
      [
        conflict("modify-modify"),
        conflict("delete-modify-local"),
        conflict("delete-modify-remote"),
        conflict("local-missing-remote"),
      ],
      "preferLocal"
    );

    expect(resolvedOps).toEqual([
      { type: "push_update", path: "note.md" },
      { type: "push_delete", path: "note.md" },
      { type: "push_new", path: "note.md" },
      { type: "push_delete", path: "note.md" },
    ]);
    expect(conflictRecords).toHaveLength(4);
    expect(conflictRecords[0]?.reason).toBe("modify-modify");
  });

  it("resolves preferRemote", async () => {
    const { resolvedOps } = resolver.resolve(
      [
        conflict("modify-modify"),
        conflict("delete-modify-local"),
        conflict("delete-modify-remote"),
        conflict("local-missing-remote"),
      ],
      "preferRemote"
    );

    expect(resolvedOps).toEqual([
      { type: "pull_update", path: "note.md" },
      { type: "pull_update", path: "note.md" },
      { type: "pull_delete", path: "note.md" },
      { type: "pull_update", path: "note.md" },
    ]);
  });

  it("keeps conflicts when manual", async () => {
    const { resolvedOps, conflictRecords } = resolver.resolve(
      [conflict("modify-modify")],
      "manual"
    );

    expect(resolvedOps).toEqual([]);
    expect(conflictRecords).toHaveLength(1);
  });
});
