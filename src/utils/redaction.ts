const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [REDACTED]"],
  [/\b(access_token|refresh_token|client_secret|token)=([^&\s]+)/gi, "$1=[REDACTED]"],
  [/\b(gh[pousr]_[A-Za-z0-9_]+)\b/g, "[REDACTED_GITHUB_TOKEN]"],
];

/**
 * Redacts obvious token- and secret-shaped substrings from log-safe text.
 *
 * This helper is intentionally conservative: if a string looks like a GitHub or
 * OAuth secret, it should not survive into persisted logs or console output.
 */
export const redactSensitiveText = (value: string): string => {
  let redacted = value;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
};
