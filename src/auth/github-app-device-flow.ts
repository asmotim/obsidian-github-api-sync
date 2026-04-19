import { requestUrl } from "obsidian";
import type {
  GitHubAppDeviceFlowPollResult,
  GitHubAppDeviceFlowSession,
  GitHubAppInstallation,
  GitHubAppRepository,
  GitHubAppTokenResponse,
  GitHubAppViewer,
} from "../types/auth-types";

type OAuthJsonResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  interval?: number;
  error?: string;
  error_description?: string;
};

type ViewerResponse = {
  login: string;
};

type InstallationResponse = {
  installations?: Array<{
    id?: number;
    account?: {
      login?: string;
    };
    repository_selection?: string;
  }>;
};

type InstallationRepositoriesResponse = {
  repositories?: Array<{
    name?: string;
    full_name?: string;
    private?: boolean;
    owner?: {
      login?: string;
    };
  }>;
};

const GITHUB_LOGIN_BASE_URL = "https://github.com";
const GITHUB_API_BASE_URL = "https://api.github.com";

/**
 * Represents an OAuth-level failure returned by GitHub during device-flow or
 * refresh-token requests so callers can branch on the GitHub error code.
 */
export class GitHubAppOAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GitHubAppOAuthError";
    this.code = code;
  }
}

/**
 * Wraps the GitHub App device-flow and authenticated discovery requests used
 * by the browser-hosted plugin runtime. All requests go through Obsidian's
 * network API so the same codepath remains usable on desktop and mobile.
 */
export class GitHubAppDeviceFlowClient {
  async startDeviceFlow(clientId: string): Promise<GitHubAppDeviceFlowSession> {
    const url = this.buildLoginUrl("/login/device/code", {
      client_id: clientId,
    });
    const response = await this.requestJson<OAuthJsonResponse>(url, { method: "POST" });

    if (
      typeof response.device_code !== "string" ||
      typeof response.user_code !== "string" ||
      typeof response.verification_uri !== "string"
    ) {
      throw new Error("GitHub did not return a valid device flow session.");
    }

    const expiresIn = typeof response.expires_in === "number" ? response.expires_in : 900;
    const intervalSeconds = typeof response.interval === "number" ? response.interval : 5;

    return {
      clientId,
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      intervalSeconds,
    };
  }

  async pollForToken(session: GitHubAppDeviceFlowSession): Promise<GitHubAppDeviceFlowPollResult> {
    const url = this.buildLoginUrl("/login/oauth/access_token", {
      client_id: session.clientId,
      device_code: session.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const response = await this.requestJson<OAuthJsonResponse>(url, { method: "POST" });

    if (typeof response.error === "string") {
      if (response.error === "authorization_pending" || response.error === "slow_down") {
        return {
          status: "pending",
          error: response.error,
          intervalSeconds:
            Number.isFinite(response.interval) && typeof response.interval === "number"
              ? response.interval
              : session.intervalSeconds + (response.error === "slow_down" ? 5 : 0),
        };
      }

      return {
        status: "error",
        error: response.error,
        message: response.error_description ?? response.error,
      };
    }

    return {
      status: "success",
      token: this.parseTokenResponse(response),
    };
  }

  async refreshUserAccessToken(clientId: string, refreshToken: string): Promise<GitHubAppTokenResponse> {
    const url = this.buildLoginUrl("/login/oauth/access_token", {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await this.requestJson<OAuthJsonResponse>(url, { method: "POST" });

    if (typeof response.error === "string") {
      throw new GitHubAppOAuthError(
        response.error,
        response.error_description ?? `GitHub refresh failed: ${response.error}`
      );
    }

    return this.parseTokenResponse(response);
  }

  async getViewer(accessToken: string): Promise<GitHubAppViewer> {
    const response = await this.requestJson<ViewerResponse>(`${GITHUB_API_BASE_URL}/user`, {
      method: "GET",
      accessToken,
    });

    if (typeof response.login !== "string" || response.login.trim().length === 0) {
      throw new Error("GitHub did not return a valid user profile.");
    }

    return {
      login: response.login,
    };
  }

  async listInstallations(accessToken: string): Promise<GitHubAppInstallation[]> {
    const installations = await this.requestAllPages<InstallationResponse>(
      `${GITHUB_API_BASE_URL}/user/installations`,
      accessToken
    );

    return installations
      .flatMap((page) => page.installations ?? [])
      .map((installation): GitHubAppInstallation => {
        const repositorySelection =
          installation.repository_selection === "all" || installation.repository_selection === "selected"
            ? installation.repository_selection
            : "unknown";
        return {
          id: typeof installation.id === "number" ? installation.id : 0,
          accountLogin: installation.account?.login?.trim() ?? "",
          repositorySelection,
        };
      })
      .filter((installation) => installation.id > 0 && installation.accountLogin.length > 0);
  }

  async listInstallationRepositories(
    accessToken: string,
    installation: GitHubAppInstallation
  ): Promise<GitHubAppRepository[]> {
    const pages = await this.requestAllPages<InstallationRepositoriesResponse>(
      `${GITHUB_API_BASE_URL}/user/installations/${installation.id}/repositories`,
      accessToken
    );

    return pages
      .flatMap((page) => page.repositories ?? [])
      .map((repository) => ({
        installationId: installation.id,
        owner: repository.owner?.login?.trim() ?? installation.accountLogin,
        repo: repository.name?.trim() ?? "",
        fullName: repository.full_name?.trim() ?? "",
        private: repository.private === true,
        accountLogin: installation.accountLogin,
      }))
      .filter((repository) => {
        return (
          repository.owner.length > 0 &&
          repository.repo.length > 0 &&
          repository.fullName.length > 0
        );
      });
  }

  private parseTokenResponse(response: OAuthJsonResponse): GitHubAppTokenResponse {
    if (typeof response.access_token !== "string" || typeof response.token_type !== "string") {
      throw new Error("GitHub did not return a valid access token.");
    }

    return {
      accessToken: response.access_token,
      refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : "",
      accessTokenExpiresAt:
        typeof response.expires_in === "number"
          ? new Date(Date.now() + response.expires_in * 1000).toISOString()
          : null,
      refreshTokenExpiresAt:
        typeof response.refresh_token_expires_in === "number"
          ? new Date(Date.now() + response.refresh_token_expires_in * 1000).toISOString()
          : null,
      tokenType: response.token_type,
      scope: typeof response.scope === "string" ? response.scope : "",
    };
  }

  private buildLoginUrl(path: string, query: Record<string, string>): string {
    const url = new URL(`${GITHUB_LOGIN_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async requestJson<T>(
    url: string,
    init: { method: "GET" | "POST"; accessToken?: string }
  ): Promise<T> {
    const response = await requestUrl({
      url,
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.accessToken
          ? {
              Authorization: `Bearer ${init.accessToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            }
          : {}),
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GitHub OAuth error ${response.status}: ${response.text}`);
    }

    if (response.json && typeof response.json === "object") {
      return response.json as T;
    }

    return JSON.parse(response.text) as T;
  }

  private async requestAllPages<T>(baseUrl: string, accessToken: string): Promise<T[]> {
    const pages: T[] = [];
    let page = 1;

    while (true) {
      const separator = baseUrl.includes("?") ? "&" : "?";
      const url = `${baseUrl}${separator}per_page=100&page=${page}`;
      const response = await this.requestJson<T>(url, {
        method: "GET",
        accessToken,
      });
      pages.push(response);

      const currentPageRepositories = this.countPageItems(response);
      if (currentPageRepositories < 100) {
        return pages;
      }

      page += 1;
    }
  }

  private countPageItems(response: unknown): number {
    if (!response || typeof response !== "object") {
      return 0;
    }

    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj.installations)) {
      return obj.installations.length;
    }
    if (Array.isArray(obj.repositories)) {
      return obj.repositories.length;
    }
    return 0;
  }
}
