import { App, PluginSettingTab, Setting } from "obsidian";
import type GitHubApiSyncPlugin from "../main";

export class SettingsView extends PluginSettingTab {
  private plugin: GitHubApiSyncPlugin;

  constructor(app: App, plugin: GitHubApiSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setHeading().setName("GitHub API sync");

    new Setting(containerEl)
      .setName("GitHub token")
      .setDesc("Requires repo scope for private repositories. Kept only for this session unless persistence is enabled.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Ghp_...")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Persist token on disk")
      .setDesc("Disabled by default for safer secret handling. Enable only on trusted devices.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.persistToken).onChange(async (value) => {
          this.plugin.settings.persistToken = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Owner")
      .addText((text) =>
        text
          .setPlaceholder("Owner")
          .setValue(this.plugin.settings.owner)
          .onChange(async (value) => {
            this.plugin.settings.owner = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Repository")
      .addText((text) =>
        text
          .setPlaceholder("Repo")
          .setValue(this.plugin.settings.repo)
          .onChange(async (value) => {
            this.plugin.settings.repo = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Branch")
      .addText((text) =>
        text
          .setPlaceholder("Main")
          .setValue(this.plugin.settings.branch)
          .onChange(async (value) => {
            this.plugin.settings.branch = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Root path")
      .setDesc("Vault-relative path to sync. Leave empty for entire vault.")
      .addText((text) =>
        text
          .setPlaceholder("Journal")
          .setValue(this.plugin.settings.rootPath)
          .onChange(async (value) => {
            this.plugin.settings.rootPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Repository scope")
      .setDesc("Choose whether to sync to repository root or to a dedicated subfolder.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("fullRepo", "Full repository")
          .addOption("subfolder", "Subfolder only")
          .setValue(this.plugin.settings.repoScopeMode)
          .onChange(async (value) => {
            this.plugin.settings.repoScopeMode = value as typeof this.plugin.settings.repoScopeMode;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Repository subfolder")
      .setDesc(
        "Remote subfolder used when Repository scope is 'Subfolder only' (e.g. vault)."
      )
      .addText((text) =>
        text
          .setPlaceholder("vault")
          .setValue(this.plugin.settings.repoSubfolder)
          .onChange(async (value) => {
            this.plugin.settings.repoSubfolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc("Comma-separated list of ignore patterns.")
      .addTextArea((text) =>
        text
          .setPlaceholder(".git/")
          .setValue(this.plugin.settings.ignorePatterns.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.ignorePatterns = value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            this.plugin.settings.conflictPolicy = value as typeof this.plugin.settings.conflictPolicy;
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            const trimmed = value.trim();
            this.plugin.settings.syncIntervalMinutes =
              trimmed.length === 0 ? null : Number(trimmed);
            await this.plugin.saveSettings();
          })
      );
  }
}
