import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubAppDeviceFlowClient } from "../src/auth/github-app-device-flow";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

type MockResponse = {
  status: number;
  headers: Record<string, string>;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
};

const makeResponse = (options: {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}): MockResponse => ({
  status: options.status,
  headers: options.headers ?? {},
  json: options.json ?? {},
  text: options.text ?? "",
  arrayBuffer: new ArrayBuffer(0),
});

describe("GitHubAppDeviceFlowClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the device flow and returns a session", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);
    requestUrlMock.mockResolvedValue(
      makeResponse({
        status: 200,
        json: {
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        },
      })
    );

    const client = new GitHubAppDeviceFlowClient();
    const session = await client.startDeviceFlow("Iv1.testclient");

    expect(session).toMatchObject({
      clientId: "Iv1.testclient",
      deviceCode: "device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      intervalSeconds: 5,
    });

    const firstCall = requestUrlMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected requestUrl to be called");
    }
    const call = firstCall[0];
    if (typeof call === "string") {
      throw new Error("Expected RequestUrlParam object");
    }
    expect(call.url).toContain("/login/device/code");
    expect(call.url).toContain("client_id=Iv1.testclient");
  });

  it("returns slow_down polling state with the updated interval", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);
    requestUrlMock.mockResolvedValue(
      makeResponse({
        status: 200,
        json: {
          error: "slow_down",
          interval: 10,
        },
      })
    );

    const client = new GitHubAppDeviceFlowClient();
    const result = await client.pollForToken({
      clientId: "Iv1.testclient",
      deviceCode: "device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAt: new Date(10_000).toISOString(),
      intervalSeconds: 5,
    });

    expect(result).toEqual({
      status: "pending",
      error: "slow_down",
      intervalSeconds: 10,
    });
  });

  it("refreshes a user access token", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);
    requestUrlMock.mockResolvedValue(
      makeResponse({
        status: 200,
        json: {
          access_token: "ghu_new",
          refresh_token: "ghr_new",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
          scope: "",
        },
      })
    );

    const client = new GitHubAppDeviceFlowClient();
    const token = await client.refreshUserAccessToken("Iv1.testclient", "ghr_old");

    expect(token.accessToken).toBe("ghu_new");
    expect(token.refreshToken).toBe("ghr_new");
  });

  it("throws a typed error for refresh failures", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);
    requestUrlMock.mockResolvedValue(
      makeResponse({
        status: 200,
        json: {
          error: "bad_refresh_token",
          error_description: "refresh failed",
        },
      })
    );

    const client = new GitHubAppDeviceFlowClient();

    await expect(client.refreshUserAccessToken("Iv1.testclient", "ghr_old")).rejects.toEqual(
      expect.objectContaining({
        code: "bad_refresh_token",
        message: "refresh failed",
      })
    );
  });

  it("lists installations and repositories across pages", async () => {
    const { requestUrl } = await import("obsidian");
    const requestUrlMock = vi.mocked(requestUrl);
    requestUrlMock
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: {
            installations: Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              account: { login: `acct-${index + 1}` },
              repository_selection: "selected",
            })),
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: {
            installations: [
              {
                id: 101,
                account: { login: "acct-101" },
                repository_selection: "all",
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          status: 200,
          json: {
            repositories: [
              {
                name: "notes",
                full_name: "acct-101/notes",
                private: true,
                owner: { login: "acct-101" },
              },
            ],
          },
        })
      );

    const client = new GitHubAppDeviceFlowClient();
    const installations = await client.listInstallations("ghu_test");
    const repositories = await client.listInstallationRepositories("ghu_test", {
      id: 101,
      accountLogin: "acct-101",
      repositorySelection: "all",
    });

    expect(installations).toHaveLength(101);
    expect(repositories).toEqual([
      {
        installationId: 101,
        owner: "acct-101",
        repo: "notes",
        fullName: "acct-101/notes",
        private: true,
        accountLogin: "acct-101",
      },
    ]);
  });
});
