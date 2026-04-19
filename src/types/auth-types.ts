export type GitHubAppAuthStatus = "disconnected" | "connected" | "refreshing" | "reauth_required";

export type GitHubAppDeviceFlowPendingError = "authorization_pending" | "slow_down";

export type GitHubAppDeviceFlowTerminalError =
  | "access_denied"
  | "bad_verification_code"
  | "device_flow_disabled"
  | "expired_token"
  | "incorrect_client_credentials"
  | "incorrect_device_code"
  | "unsupported_grant_type";

type GitHubAppUnknownOAuthError = string & {};

export type GitHubAppAuthState = {
  provider: "githubApp";
  status: GitHubAppAuthStatus;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  githubUserLogin: string;
  installationId: number | null;
  installationAccountLogin: string;
  selectedOwner: string;
  selectedRepo: string;
};

export type GitHubAppDeviceFlowSession = {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
};

export type GitHubAppTokenResponse = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  tokenType: string;
  scope: string;
};

export type GitHubAppDeviceFlowPollResult =
  | {
      status: "pending";
      error: GitHubAppDeviceFlowPendingError;
      intervalSeconds: number;
    }
  | {
      status: "success";
      token: GitHubAppTokenResponse;
    }
  | {
      status: "error";
      error: GitHubAppDeviceFlowTerminalError | GitHubAppUnknownOAuthError;
      message: string;
    };

export type GitHubAppViewer = {
  login: string;
};

export type GitHubAppInstallation = {
  id: number;
  accountLogin: string;
  repositorySelection: "all" | "selected" | "unknown";
};

export type GitHubAppRepository = {
  installationId: number;
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  accountLogin: string;
};
