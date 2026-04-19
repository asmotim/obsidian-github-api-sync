import { Modal, Notice } from "obsidian";
import { GitHubAuthManager } from "../auth/github-auth-manager";
import type GitHubApiSyncPlugin from "../main";
import type { GitHubAppDeviceFlowSession } from "../types/auth-types";

type GitHubAppAuthModalOptions = {
  onConnected?: () => void;
};

export class GitHubAppAuthModal extends Modal {
  private readonly authManager: GitHubAuthManager;
  private readonly onConnected: (() => void) | undefined;
  private session: GitHubAppDeviceFlowSession | null = null;
  private errorMessage: string | null = null;
  private statusMessage = "Starting GitHub authorization...";
  private isLoading = true;
  private flowRunId = 0;

  constructor(plugin: GitHubApiSyncPlugin, options: GitHubAppAuthModalOptions = {}) {
    super(plugin.app);
    this.authManager = new GitHubAuthManager(plugin);
    this.onConnected = options.onConnected;
  }

  override onOpen(): void {
    void this.startFlow();
  }

  override onClose(): void {
    this.flowRunId += 1;
    this.contentEl.empty();
  }

  private async startFlow(): Promise<void> {
    this.flowRunId += 1;
    const runId = this.flowRunId;
    this.session = null;
    this.errorMessage = null;
    this.statusMessage = "Starting GitHub authorization...";
    this.isLoading = true;
    this.render();

    try {
      const session = await this.authManager.startDeviceFlow();
      if (!this.isCurrentRun(runId)) {
        return;
      }

      this.session = session;
      this.statusMessage = "Waiting for GitHub authorization in your browser...";
      this.isLoading = false;
      this.render();
      void this.pollUntilComplete(runId);
    } catch (error) {
      if (!this.isCurrentRun(runId)) {
        return;
      }
      this.isLoading = false;
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private async pollUntilComplete(runId: number): Promise<void> {
    while (this.isCurrentRun(runId) && this.session) {
      try {
        const result = await this.authManager.pollDeviceFlow(this.session);
        if (!this.isCurrentRun(runId) || !this.session) {
          return;
        }

        if (result.status === "success") {
          await this.authManager.completeDeviceFlow(result.token);
          new Notice("GitHub App connected.");
          this.onConnected?.();
          this.close();
          return;
        }

        if (result.status === "pending") {
          this.session = {
            ...this.session,
            intervalSeconds: result.intervalSeconds,
          };
          this.statusMessage =
            result.error === "slow_down"
              ? "GitHub asked the plugin to slow down. Still waiting for authorization..."
              : "Waiting for GitHub authorization in your browser...";
          this.render();
          await this.sleep(result.intervalSeconds * 1000);
          continue;
        }

        this.errorMessage = this.describeTerminalError(result.error);
        this.isLoading = false;
        this.render();
        return;
      } catch (error) {
        if (!this.isCurrentRun(runId)) {
          return;
        }
        this.errorMessage = error instanceof Error ? error.message : String(error);
        this.isLoading = false;
        this.render();
        return;
      }
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Connect GitHub App" });
    contentEl.createEl("p", {
      text: "Open GitHub in your browser, enter the device code, and come back to Obsidian. The plugin keeps polling automatically.",
    });

    if (this.session) {
      const card = contentEl.createDiv({ cls: "github-api-sync-auth-card" });
      card.createEl("div", {
        cls: "github-api-sync-auth-label",
        text: "Device code",
      });
      card.createEl("code", {
        cls: "github-api-sync-auth-code",
        text: this.session.userCode,
      });
      card.createEl("div", {
        cls: "github-api-sync-auth-meta",
        text: `Authorize at ${this.session.verificationUri}`,
      });
      card.createEl("div", {
        cls: "github-api-sync-auth-meta",
        text: `Code expires at ${new Date(this.session.expiresAt).toLocaleTimeString()}`,
      });

      const actions = card.createDiv({ cls: "github-api-sync-auth-actions" });
      const openButton = actions.createEl("button", { text: "Open GitHub" });
      openButton.onclick = () => {
        window.open(this.session?.verificationUri ?? "https://github.com/login/device", "_blank", "noopener");
      };

      const copyCodeButton = actions.createEl("button", { text: "Copy code" });
      copyCodeButton.onclick = () => {
        void this.copyToClipboard(this.session?.userCode ?? "", "Code copied.");
      };

      const copyUrlButton = actions.createEl("button", { text: "Copy link" });
      copyUrlButton.onclick = () => {
        void this.copyToClipboard(this.session?.verificationUri ?? "", "Link copied.");
      };
    }

    const statusEl = contentEl.createDiv({ cls: "github-api-sync-auth-status" });
    statusEl.setText(this.statusMessage);
    if (this.errorMessage) {
      statusEl.addClass("github-api-sync-auth-status-error");
      statusEl.setText(this.errorMessage);
    }

    const footer = contentEl.createDiv({ cls: "github-api-sync-auth-actions" });
    const restartButton = footer.createEl("button", { text: "Restart" });
    restartButton.disabled = this.isLoading;
    restartButton.onclick = () => {
      void this.startFlow();
    };

    const closeButton = footer.createEl("button", { text: "Close" });
    closeButton.onclick = () => {
      this.close();
    };
  }

  private describeTerminalError(error: string): string {
    switch (error) {
      case "access_denied":
        return "GitHub authorization was canceled.";
      case "device_flow_disabled":
        return "Device flow is not enabled for this GitHub App.";
      case "incorrect_client_credentials":
        return "The built-in GitHub App client ID is invalid.";
      case "incorrect_device_code":
      case "bad_verification_code":
      case "expired_token":
        return "The device code expired. Start the flow again.";
      case "unsupported_grant_type":
        return "GitHub rejected the device-flow grant type.";
      default:
        return `GitHub authorization failed: ${error}`;
    }
  }

  private async copyToClipboard(text: string, successMessage: string): Promise<void> {
    if (text.length === 0) {
      return;
    }

    try {
      await window.navigator.clipboard.writeText(text);
      new Notice(successMessage);
    } catch {
      new Notice("Clipboard access failed.");
    }
  }

  private isCurrentRun(runId: number): boolean {
    return runId === this.flowRunId;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
