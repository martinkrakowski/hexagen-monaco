const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";

function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

function colorize(color: string, text: string): string {
  return isTTY() ? `${color}${text}${RESET}` : text;
}

export function formatError(message: string): string {
  return `${colorize(RED, "❌")} ${message}`;
}

export function formatWarning(message: string): string {
  return `${colorize(YELLOW, "⚠️")} ${message}`;
}

export function formatSuccess(message: string): string {
  return `${colorize(GREEN, "✅")} ${message}`;
}

export function formatInfo(message: string): string {
  return `ℹ️  ${message}`;
}

export function formatBold(text: string): string {
  return colorize(BOLD, text);
}

export function formatSection(title: string): string {
  return `\n${formatBold(title)}\n${"─".repeat(title.length)}`;
}
