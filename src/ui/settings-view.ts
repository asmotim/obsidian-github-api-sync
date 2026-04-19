import { PluginSettingTab, Setting, type App } from "obsidian";
import { GitHubAuthManager } from "../auth/github-auth-manager";
import { SHARED_GITHUB_APP } from "../config/shared-github-app";
import type GitHubApiSyncPlugin from "../main";
import type { GitHubAppAuthState, GitHubAppRepository } from "../types/auth-types";
import { GitHubAppAuthModal } from "./github-app-auth-modal";

export class SettingsView extends PluginSettingTab {
  private plugin: GitHubApiSyncPlugin;

  constructor(app: App, plugin: GitHubApiSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const authManager = new GitHubAuthManager(this.plugin);
    const authState = await authManager.loadGitHubAppAuthState();
    const availableRepositories = authState
      ? await this.loadAvailableRepositories(authManager)
      : [];
    const selectedRepository = await this.resolveSelectedRepository(
      authManager,
      availableRepositories
    );
    const storedPreview = await this.plugin.loadSyncPreview();

    new Setting(containerEl).setHeading().setName("GitHub API sync");

    new Setting(containerEl)
      .setName("Shared GitHub App")
      .setDesc(
        `Uses the built-in public GitHub App ${SHARED_GITHUB_APP.name} for a device-flow login that works on desktop and mobile.`
      )
      .addButton((button) =>
        button.setButtonText("View app").onClick(() => {
          window.open(SHARED_GITHUB_APP.publicUrl, "_blank", "noopener");
        })
      )
      .addButton((button) =>
        button.setButtonText("Install app").onClick(() => {
          window.open(SHARED_GITHUB_APP.installUrl, "_blank", "noopener");
        })
      );

    new Setting(containerEl)
      .setName("GitHub App connection")
      .setDesc(this.describeGitHubAppStatus(authState))
      .addButton((button) =>
        button
          .setButtonText(authState ? "Reconnect" : "Connect")
          .onClick(() => {
            new GitHubAppAuthModal(this.plugin, {
              onConnected: () => this.display(),
            }).open();
          })
      )
      .addButton((button) =>
        button
          .setButtonText("Disconnect")
          .setDisabled(!authState)
          .onClick(() => {
            void (async () => {
              await authManager.disconnectGitHubApp();
              this.display();
            })();
          })
      );

    this.renderActionButtons(containerEl, Boolean(storedPreview?.approval.required));

    if (authState && availableRepositories.length === 0) {
      new Setting(containerEl)
        .setName("Repository access")
        .setDesc(
          "No repositories are visible through the shared GitHub App yet. Install the app on a repository or refresh the repository list."
        )
        .addButton((button) =>
          button.setButtonText("Refresh list").onClick(() => {
            this.display();
          })
        );
    }

    if (availableRepositories.length > 0) {
      const repositoryDropdownValue =
        selectedRepository?.fullName ??
        (availableRepositories.length === 1 ? availableRepositories[0]?.fullName ?? "" : "");

      new Setting(containerEl)
        .setName("Repository")
        .setDesc(
          selectedRepository
            ? `Syncing ${selectedRepository.fullName} via ${selectedRepository.accountLogin}. ${
                availableRepositories.length === 1
                  ? "Only one repository is available and it was selected automatically."
                  : "Choose from repositories available through the installed shared GitHub App."
              }`
            : "Choose a repository from the installed shared GitHub App to fill owner and repo automatically."
        )
        .addDropdown((dropdown) => {
          if (availableRepositories.length > 1 && !selectedRepository) {
            dropdown.addOption("", "Select a repository");
          }

          for (const repository of availableRepositories) {
            dropdown.addOption(
              repository.fullName,
              this.describeRepositoryOption(repository)
            );
          }

          return dropdown
            .setValue(repositoryDropdownValue)
            .onChange((value) => {
              const repository = availableRepositories.find((entry) => entry.fullName === value);
              if (!repository) {
                return;
              }

              void this.applySelectedRepository(authManager, repository);
            });
        })
        .addButton((button) =>
          button.setButtonText("Refresh list").onClick(() => {
            this.display();
          })
        );
    }

    if (availableRepositories.length === 0) {
      new Setting(containerEl)
        .setName("Owner")
        .addText((text) =>
          text
            .setPlaceholder("Owner")
            .setValue(this.plugin.settings.owner)
            .onChange((value) => {
              void (async () => {
                this.plugin.settings.owner = value.trim();
                await this.plugin.saveSettings();
              })();
            })
        );

      new Setting(containerEl)
        .setName("Repository")
        .addText((text) =>
          text
            .setPlaceholder("Repo")
            .setValue(this.plugin.settings.repo)
            .onChange((value) => {
              void (async () => {
                this.plugin.settings.repo = value.trim();
                await this.plugin.saveSettings();
              })();
            })
        );
    }

    new Setting(containerEl)
      .setName("Branch")
      .addText((text) =>
        text
          .setPlaceholder("Main")
          .setValue(this.plugin.settings.branch)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.branch = value.trim();
              await this.plugin.saveSettings();
            })();
          })
      );

    new Setting(containerEl)
      .setName("Remote sync root")
      .setDesc("Choose whether the plugin syncs to the repository root or to a dedicated remote subfolder.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("fullRepo", "Full repository")
          .addOption("subfolder", "Subfolder only")
          .setValue(this.plugin.settings.repoScopeMode)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.repoScopeMode = value as typeof this.plugin.settings.repoScopeMode;
              await this.plugin.saveSettings();
              this.display();
            })();
          })
      );

    if (this.plugin.settings.repoScopeMode === "subfolder") {
      new Setting(containerEl)
        .setName("Remote sync root path")
        .setDesc("Used when Remote sync root is 'Subfolder only' (for example vault).")
        .addText((text) =>
          text
            .setPlaceholder("vault")
            .setValue(this.plugin.settings.repoSubfolder)
            .onChange((value) => {
              void (async () => {
                this.plugin.settings.repoSubfolder = value.trim();
                await this.plugin.saveSettings();
              })();
            })
        );
    }

    new Setting(containerEl)
      .setName("Local sync root (optional)")
      .setDesc("Vault-relative folder to sync locally. Leave empty to include the entire vault.")
      .addText((text) =>
        text
          .setPlaceholder("Journal")
          .setValue(this.plugin.settings.rootPath)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.rootPath = value.trim();
              await this.plugin.saveSettings();
            })();
          })
      );

    new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc("Comma-separated list of ignore patterns.")
      .addTextArea((text) =>
        text
          .setPlaceholder(".git/")
          .setValue(this.plugin.settings.ignorePatterns.join(", "))
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.ignorePatterns = value
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0);
              await this.plugin.saveSettings();
            })();
          })
      );

    new Setting(containerEl)
      .setName("Conflict policy")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("keepBoth", "Keep both")
          .addOption("preferLocal", "Prefer local")
          .addOption("preferRemote", "Prefer remote")
          .addOption("manual", "Manual")
          .setValue(this.plugin.settings.conflictPolicy)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.conflictPolicy = value as typeof this.plugin.settings.conflictPolicy;
              await this.plugin.saveSettings();
            })();
          })
      );

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("Leave empty to disable scheduled sync.")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(
            this.plugin.settings.syncIntervalMinutes === null
              ? ""
              : String(this.plugin.settings.syncIntervalMinutes)
          )
          .onChange((value) => {
            void (async () => {
              const trimmed = value.trim();
              this.plugin.settings.syncIntervalMinutes =
                trimmed.length === 0 ? null : Number(trimmed);
              await this.plugin.saveSettings();
            })();
          })
      );
  }

  private async loadAvailableRepositories(
    authManager: GitHubAuthManager
  ): Promise<GitHubAppRepository[]> {
    try {
      return await authManager.listAvailableRepositories();
    } catch {
      return [];
    }
  }

  private async applySelectedRepository(
    authManager: GitHubAuthManager,
    repository: GitHubAppRepository
  ): Promise<void> {
    this.plugin.settings.owner = repository.owner;
    this.plugin.settings.repo = repository.repo;
    await authManager.rememberSelectedRepository(repository);
    await this.plugin.saveSettings();
    this.display();
  }

  private async resolveSelectedRepository(
    authManager: GitHubAuthManager,
    availableRepositories: GitHubAppRepository[]
  ): Promise<GitHubAppRepository | null> {
    const preferred = await authManager.pickPreferredRepository(availableRepositories, {
      owner: this.plugin.settings.owner,
      repo: this.plugin.settings.repo,
    });

    if (!preferred) {
      return null;
    }

    const currentFullName = `${this.plugin.settings.owner}/${this.plugin.settings.repo}`.trim();
    if (currentFullName !== preferred.fullName) {
      this.plugin.settings.owner = preferred.owner;
      this.plugin.settings.repo = preferred.repo;
      await authManager.rememberSelectedRepository(preferred);
      await this.plugin.saveSettings();
    }

    return preferred;
  }

  private renderActionButtons(containerEl: HTMLElement, hasApprovalPreview: boolean): void {
    new Setting(containerEl).setName("Quick actions").setDesc(
      "Run sync, preview, health, logs, conflicts, and baseline repair without leaving settings."
    );

    const firstRow = containerEl.createDiv({ cls: "github-api-sync-action-row" });
    this.createActionButton(firstRow, "Sync now", async () => {
      await this.plugin.triggerSyncNow();
    });
    this.createActionButton(firstRow, "Preview plan", async () => {
      await this.plugin.triggerSyncPreview();
    });
    this.createActionButton(firstRow, "Show health", () => {
      this.plugin.openSyncHealth();
    });

    const secondRow = containerEl.createDiv({ cls: "github-api-sync-action-row" });
    this.createActionButton(secondRow, "Show log", () => {
      this.plugin.openSyncLog();
    });
    this.createActionButton(secondRow, "Conflicts", () => {
      this.plugin.openSyncConflicts();
    });
    this.createActionButton(secondRow, "Repair baseline", async () => {
      await this.plugin.triggerRepairBaseline();
    });

    if (hasApprovalPreview) {
      const warning = containerEl.createDiv({ cls: "github-api-sync-inline-note" });
      warning.setText(
        "A stored preview currently requires approval before a destructive sync can continue."
      );
      const approvalRow = containerEl.createDiv({ cls: "github-api-sync-action-row" });
      this.createActionButton(approvalRow, "Approve and run", async () => {
        await this.plugin.triggerApprovedSync();
      });
      this.createActionButton(approvalRow, "Open preview", () => {
        this.plugin.openSyncPreview();
      });
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

  private describeRepositoryOption(repository: GitHubAppRepository): string {
    const visibility = repository.private ? "private" : "public";
    return `${repository.fullName} (${visibility}, via ${repository.accountLogin})`;
  }

  private describeGitHubAppStatus(authState: GitHubAppAuthState | null): string {
    if (!authState) {
      return `No GitHub App login is stored on this device yet. The plugin uses ${SHARED_GITHUB_APP.name} by default.`;
    }

    const accessExpiry = authState.accessTokenExpiresAt
      ? new Date(authState.accessTokenExpiresAt).toLocaleString()
      : "no expiry returned";

    switch (authState.status) {
      case "connected":
        return `Connected as ${authState.githubUserLogin || "GitHub user"}. Access token refreshes automatically and is currently valid until ${accessExpiry}.`;
      case "refreshing":
        return `Refreshing GitHub App login for ${authState.githubUserLogin || "GitHub user"}...`;
      case "reauth_required":
        return "Stored GitHub App tokens can no longer be refreshed. Reconnect to continue syncing.";
      case "disconnected":
      default:
        return "No GitHub App login is active.";
    }
  }
}
