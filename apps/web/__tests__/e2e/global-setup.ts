import { chromium } from "@playwright/test";

export default async function globalSetup() {
  const browser = await chromium.launch();
  await browser.close();
}
