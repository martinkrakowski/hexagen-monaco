// @hexagen-server-only
import { imsTokenProvider } from "./ims-token-provider.adapter";

/**
 * Smoke test: verify Adobe IMS Server-to-Server credentials acquire a token.
 * Run: npx tsx src/infrastructure/adobe/auth/smoke-token.ts
 */
async function main(): Promise<void> {
  const token = await imsTokenProvider.getAccessToken();
  // Never print the token itself — confirm acquisition only.
  console.log(`✓ IMS token acquired (length ${token.length}).`);
}

main().catch((error: unknown) => {
  console.error("✗ IMS token flow failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
