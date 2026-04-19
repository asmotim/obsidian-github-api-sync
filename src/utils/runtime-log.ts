import { redactSensitiveText } from "./redaction";

/**
 * Small runtime logger wrapper that keeps accidental secret output out of
 * console logs in development, manual tests, and user bug reports.
 */
export const runtimeLog = {
  warn(message: string): void {
    console.warn(redactSensitiveText(message));
  },
  error(message: string): void {
    console.error(redactSensitiveText(message));
  },
};
