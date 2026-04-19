import { normalizePath } from "obsidian";

/**
 * Returns whether a vault-relative path matches the current ignore rules.
 * Directory patterns ending in `/` apply to the whole subtree.
 */
export const isIgnoredPath = (path: string, ignorePatterns: string[]): boolean => {
  if (ignorePatterns.length === 0) {
    return false;
  }

  const normalized = normalizePath(path);

  for (const pattern of ignorePatterns) {
    const trimmed = pattern.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.endsWith("/")) {
      const dirPattern = normalizePath(trimmed);
      if (normalized.startsWith(dirPattern) || normalized === dirPattern.slice(0, -1)) {
        return true;
      }
      continue;
    }

    if (matchesGlob(normalized, normalizePath(trimmed))) {
      return true;
    }
  }

  return false;
};

/**
 * Returns whether any path segment is hidden, such as `.obsidian` or `.gitkeep`.
 * Hidden segments are treated as sensitive or non-user content during sync.
 */
export const hasHiddenPathSegment = (path: string): boolean => {
  const normalized = normalizePath(path);
  return normalized.split("/").some((segment) => segment.startsWith(".") && segment.length > 1);
};

const matchesGlob = (path: string, pattern: string): boolean => {
  const regex = globToRegExp(pattern);
  return regex.test(path);
};

const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withGlobstar = escaped.replace(/\*\*/g, "__GLOBSTAR__");
  const withStar = withGlobstar.replace(/\*/g, "[^/]*");
  const withQuestion = withStar.replace(/\?/g, "[^/]");
  const source = withQuestion.replace(/__GLOBSTAR__/g, ".*");
  return new RegExp(`^${source}$`);
};
