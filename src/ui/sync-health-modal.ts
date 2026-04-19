import { Modal, Setting } from "obsidian";
import type GitHubApiSyncPlugin from "../main";

export class SyncHealthModal extends Modal {
  private readonly plugin: GitHubApiSyncPlugin;

  constructor(plugin: GitHubApiSyncPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  override async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setHeading().setName("Sync health");

    const health = await this.plugin.loadSyncHealth();
    if (!health) {
      contentEl.createEl("p", { text: "No sync health data is stored yet." });
      return;
    }

    const lines = [
      `Updated: ${health.updatedAt}`,
      `Last action: ${health.lastAction}`,
      `Last result: ${health.lastResult}`,
      `Message: ${health.lastMessage}`,
      `Repository: ${health.owner}/${health.repo} (${health.branch})`,
      `Local sync root: ${health.rootPath || "(whole vault)"}`,
      `Remote sync root: ${
        health.repoScopeMode === "subfolder" ? health.repoSubfolder || "vault" : "(repository root)"
      }`,
      `Baseline entries: ${health.baselineEntryCount}`,
      `Auth status: ${health.authStatus}`,
      `Preview approval required: ${health.previewApprovalRequired ? "yes" : "no"}`,
      health.previewApprovalKey ? `Preview approval key: ${health.previewApprovalKey}` : "",
      "",
      "Diagnostics:",
      ...(health.diagnostics.length > 0
        ? health.diagnostics.map((entry) => `- [${entry.level}] ${entry.code}: ${entry.message}`)
        : ["- none"]),
      "",
      "Rate limit:",
      health.rateLimit
        ? `- remaining ${health.rateLimit.remaining ?? "?"}/${health.rateLimit.limit ?? "?"}, reset ${health.rateLimit.resetAt ?? "unknown"}, retry-after ${health.rateLimit.retryAfterSeconds ?? "n/a"}`
        : "- none",
    ].filter((line) => line.length > 0);

    const textarea = contentEl.createEl("textarea");
    textarea.value = lines.join("\n");
    textarea.readOnly = true;
    textarea.rows = 18;
    textarea.cols = 72;
    textarea.addClass("github-api-sync-log-textarea");
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
