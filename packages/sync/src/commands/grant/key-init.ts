/* eslint-disable no-console */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  engagementKeyPath,
  isValidEngagementId,
  keyFingerprint,
} from "@hexagen/shared/node/grant-key";

export interface KeyInitOptions {
  engagement: string;
  keyFile?: string;
  /** Test seam; defaults to `os.homedir()`. */
  homeDir?: string;
}

/**
 * The only place outside repo mode that mints a grant-signing key. Writes 32
 * random bytes as hex at mode 0600 (directory 0700) and refuses to overwrite:
 * replacing a key silently invalidates every grant already issued under it.
 * Prints the path and fingerprint, never the key.
 */
export async function grantKeyInitCommand(
  options: KeyInitOptions,
): Promise<void> {
  if (!isValidEngagementId(options.engagement)) {
    console.error(
      `Invalid engagement id '${options.engagement}': use A-Z a-z 0-9 . _ - (1-64 chars, no "..").`,
    );
    process.exitCode = 1;
    return;
  }
  const keyPath = options.keyFile
    ? path.resolve(options.keyFile)
    : engagementKeyPath(options.engagement, options.homeDir);
  const keyHex = randomBytes(32).toString("hex");
  try {
    await mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    await writeFile(keyPath, `${keyHex}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(
        `A key already exists at ${keyPath}; refusing to overwrite it (every grant signed with it would stop verifying).`,
      );
    } else {
      console.error(
        `Could not write the key at ${keyPath}: ${(error as Error).message}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`key: ${keyPath}`);
  console.log(`fingerprint ${keyFingerprint(keyHex)}`);
}

export const grantKeyCommander = new Command("key").description(
  "Manage grant-signing keys kept outside the client repo",
);

grantKeyCommander
  .command("init")
  .description(
    "Mint a grant-signing key for an engagement at ~/.hexagen/keys/<engagement>.key (never overwrites)",
  )
  .requiredOption("--engagement <id>", "Engagement id (the slice id)")
  .option("--key-file <path>", "Write the key here instead of ~/.hexagen/keys")
  .action(async (options: KeyInitOptions) => {
    await grantKeyInitCommand(options);
  });
