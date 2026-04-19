import { Modal, Setting } from "obsidian";
import type GitHubApiSyncPlugin from "../main";
import type { ConflictRecord, SyncOp, SyncPreview } from "../types/sync-types";

type OperationGroup = {
  title: string;
  ops: SyncOp[];
};

export class SyncPreviewModal extends Modal {
  private readonly plugin: GitHubApiSyncPlugin;

  constructor(plugin: GitHubApiSyncPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  override async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setHeading().setName("Sync preview");

    const preview = await this.plugin.loadSyncPreview();
    if (!preview) {
      contentEl.createEl("p", { text: "No sync preview is stored yet." });
      return;
    }

    this.renderHero(contentEl, preview);
    this.renderActionButtons(contentEl, preview);
    this.renderScope(contentEl, preview);
    this.renderSummary(contentEl, preview);
    this.renderDiagnostics(contentEl, preview);
    this.renderOperations(contentEl, preview);
    this.renderConflicts(contentEl, preview.conflicts);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private renderHero(container: HTMLElement, preview: SyncPreview): void {
    const card = container.createDiv({
      cls: preview.approval.required
        ? "github-api-sync-summary-card github-api-sync-summary-card-warning"
        : "github-api-sync-summary-card",
    });

    card.createEl("h3", {
      text: preview.approval.required
        ? "Review required before this sync can continue"
        : "This sync plan looks ready to run",
    });
    card.createEl("p", {
      text: this.describePrimarySummary(preview),
    });

    if (preview.approval.required && preview.approval.reason) {
      card.createEl("p", {
        cls: "github-api-sync-inline-note",
        text: preview.approval.reason,
      });
    }
  }

  private renderActionButtons(container: HTMLElement, preview: SyncPreview): void {
    const row = container.createDiv({ cls: "github-api-sync-action-row" });

    this.createActionButton(row, "Refresh preview", async () => {
      this.close();
      await this.plugin.triggerSyncPreview();
    });

    if (preview.approval.required) {
      this.createActionButton(row, "Approve and run", async () => {
        await this.plugin.triggerApprovedSync();
        this.close();
      });
    } else {
      this.createActionButton(row, "Sync now", async () => {
        await this.plugin.triggerSyncNow();
        this.close();
      });
    }

    this.createActionButton(row, "Show health", () => {
      this.plugin.openSyncHealth();
    });
  }

  private renderScope(container: HTMLElement, preview: SyncPreview): void {
    const section = this.createSection(container, "Scope");
    this.appendBullets(section, [
      `Generated ${this.formatDate(preview.generatedAt)}`,
      `Repository ${preview.owner}/${preview.repo} on branch ${preview.branch}`,
      `Local sync root: ${preview.rootPath || "whole vault"}`,
      `Remote sync root: ${
        preview.repoScopeMode === "subfolder"
          ? preview.repoSubfolder || "vault"
          : "repository root"
      }`,
      preview.approval.key ? `Approval key: ${preview.approval.key}` : "",
    ]);
  }

  private renderSummary(container: HTMLElement, preview: SyncPreview): void {
    const section = this.createSection(container, "What Will Happen");
    const counts = preview.summary.counts;

    this.appendBullets(section, [
      `Download from GitHub: ${counts.pullNew} new, ${counts.pullUpdate} updated, ${counts.pullDelete} deleted locally`,
      `Upload to GitHub: ${counts.pushNew} new, ${counts.pushUpdate} updated, ${counts.pushDelete} deleted remotely`,
      `Renames: ${counts.renameLocal} local, ${counts.renameRemote} remote`,
      `Conflicts: ${preview.summary.conflictCount}`,
      `Files compared: ${preview.summary.localFileCount} local, ${preview.summary.remoteFileCount} remote, ${preview.summary.baselineFileCount} baseline`,
    ]);
  }

  private renderDiagnostics(container: HTMLElement, preview: SyncPreview): void {
    const section = this.createSection(container, "Diagnostics");
    this.appendBullets(
      section,
      preview.diagnostics.length > 0
        ? preview.diagnostics.map((entry) => `[${entry.level}] ${entry.message}`)
        : ["No warnings or fallbacks were recorded for this preview."]
    );
  }

  private renderOperations(container: HTMLElement, preview: SyncPreview): void {
    const section = this.createSection(container, "Operations");
    const groups: OperationGroup[] = [
      {
        title: "Create or update local files from GitHub",
        ops: preview.ops.filter((op) => op.type === "pull_new" || op.type === "pull_update"),
      },
      {
        title: "Delete local files",
        ops: preview.ops.filter((op) => op.type === "pull_delete"),
      },
      {
        title: "Create or update GitHub files",
        ops: preview.ops.filter((op) => op.type === "push_new" || op.type === "push_update"),
      },
      {
        title: "Delete GitHub files",
        ops: preview.ops.filter((op) => op.type === "push_delete"),
      },
      {
        title: "Rename local files",
        ops: preview.ops.filter((op) => op.type === "rename_local"),
      },
      {
        title: "Rename GitHub files",
        ops: preview.ops.filter((op) => op.type === "rename_remote"),
      },
    ];

    const activeGroups = groups.filter((group) => group.ops.length > 0);
    if (activeGroups.length === 0) {
      section.createEl("p", { text: "No file operations are currently planned." });
      return;
    }

    for (const group of activeGroups) {
      const details = section.createEl("details", { cls: "github-api-sync-preview-details" });
      if (group.title === "Delete local files" || group.title === "Delete GitHub files") {
        details.open = true;
      }

      details.createEl("summary", {
        text: `${group.title} (${group.ops.length})`,
      });

      const list = details.createEl("ul", { cls: "github-api-sync-preview-list" });
      for (const line of this.describeOps(group.ops)) {
        list.createEl("li", { text: line });
      }
    }
  }

  private renderConflicts(container: HTMLElement, conflicts: ConflictRecord[]): void {
    const section = this.createSection(container, "Conflicts");
    if (conflicts.length === 0) {
      section.createEl("p", { text: "No conflicts are currently recorded." });
      return;
    }

    const list = section.createEl("ul", { cls: "github-api-sync-preview-list" });
    for (const conflict of conflicts) {
      list.createEl("li", {
        text: `${conflict.path}: ${conflict.reason} (${conflict.type})`,
      });
    }
  }

  private describePrimarySummary(preview: SyncPreview): string {
    const counts = preview.summary.counts;
    const parts = [
      this.describeCount(counts.pullNew + counts.pullUpdate, "local file", "updated from GitHub"),
      this.describeCount(counts.pushNew + counts.pushUpdate, "GitHub file", "uploaded or updated"),
      this.describeCount(counts.pullDelete, "local file", "deleted"),
      this.describeCount(counts.pushDelete, "GitHub file", "deleted"),
      this.describeCount(
        counts.renameLocal + counts.renameRemote,
        "rename",
        "applied"
      ),
    ].filter((part) => part.length > 0);

    const summary =
      parts.length > 0 ? parts.join(", ") : "No file changes are currently planned.";
    return preview.summary.conflictCount > 0
      ? `${summary} ${preview.summary.conflictCount} conflict(s) still need attention.`
      : summary;
  }

  private describeCount(count: number, noun: string, verb: string): string {
    if (count <= 0) {
      return "";
    }
    return `${count} ${noun}${count === 1 ? "" : "s"} ${verb}`;
  }

  private describeOps(ops: SyncOp[]): string[] {
    const maxVisible = 12;
    const described = ops.slice(0, maxVisible).map((op) => this.describeOp(op));
    if (ops.length > maxVisible) {
      described.push(`… and ${ops.length - maxVisible} more`);
    }
    return described;
  }

  private describeOp(op: SyncOp): string {
    switch (op.type) {
      case "pull_new":
        return `Create locally: ${op.path}`;
      case "pull_update":
        return `Update locally: ${op.path}`;
      case "pull_delete":
        return `Delete locally: ${op.path}`;
      case "push_new":
        return `Upload to GitHub: ${op.path}`;
      case "push_update":
        return `Update in GitHub: ${op.path}`;
      case "push_delete":
        return `Delete in GitHub: ${op.path}`;
      case "rename_local":
        return `Rename locally: ${op.from} -> ${op.to}`;
      case "rename_remote":
        return `Rename in GitHub: ${op.from} -> ${op.to}`;
      case "conflict":
        return `Conflict: ${op.path}`;
    }
  }

  private formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  private createSection(container: HTMLElement, title: string): HTMLElement {
    const section = container.createDiv({ cls: "github-api-sync-preview-section" });
    section.createEl("h3", { text: title });
    return section;
  }

  private appendBullets(container: HTMLElement, lines: string[]): void {
    const list = container.createEl("ul", { cls: "github-api-sync-preview-list" });
    for (const line of lines.filter((entry) => entry.length > 0)) {
      list.createEl("li", { text: line });
    }
  }

  private createActionButton(
    parent: HTMLElement,
    label: string,
    action: () => void | Promise<void>
  ): void {
    const button = parent.createEl("button", { text: label });
    button.onclick = () => {
      void action();
    };
  }
}
