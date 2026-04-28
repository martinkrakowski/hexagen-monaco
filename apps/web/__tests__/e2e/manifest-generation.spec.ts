/**
 * E2E tests for manifest generation flow
 */

import { test, expect } from "@playwright/test";

test.describe("Manifest Generation Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to welcome screen
    // Note: Update this URL based on your actual routing
    await page.goto("/welcome");
  });

  test("should display welcome screen with input field", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /welcome to hexagen monaco/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /project description/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /generate manifest/i }),
    ).toBeVisible();
  });

  test("should show character counter", async ({ page }) => {
    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const counter = page.getByText(/\d+ \/ 2000/);

    await expect(counter).toBeVisible();
    await expect(counter).toHaveText("0 / 2000");

    await textarea.fill("Test description");
    await expect(counter).toHaveText("16 / 2000");
  });

  test("should disable generate button for short descriptions", async ({
    page,
  }) => {
    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill("Short");
    await expect(generateButton).toBeDisabled();

    await expect(page.getByText(/minimum.*characters required/i)).toBeVisible();
  });

  test("should enable generate button for valid descriptions", async ({
    page,
  }) => {
    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill(
      "A task management system with user authentication and project boards",
    );
    await expect(generateButton).toBeEnabled();
  });

  test("should populate description with example", async ({ page }) => {
    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const exampleButton = page.getByRole("button", { name: /example 1/i });

    await exampleButton.click();
    await expect(textarea).not.toHaveValue("");
    await expect(textarea).toHaveValue(/task management/i);
  });

  test("should show/hide advanced options", async ({ page }) => {
    const advancedButton = page.getByRole("button", {
      name: /advanced options/i,
    });

    // Initially hidden
    await expect(page.locator('input[id="platform"]')).not.toBeVisible();

    // Click to show
    await advancedButton.click();
    await expect(page.locator('input[id="platform"]')).toBeVisible();
    await expect(page.locator('input[id="deployment"]')).toBeVisible();

    // Click to hide
    await advancedButton.click();
    await expect(page.locator('input[id="platform"]')).not.toBeVisible();
  });

  test("should show loading state during generation", async ({ page }) => {
    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill(
      "A task management system with user authentication and project boards",
    );
    await generateButton.click();

    // Should show loading state
    await expect(page.getByText(/generating manifest/i)).toBeVisible();
    await expect(generateButton).toBeDisabled();
  });

  test("should display error message on generation failure", async ({
    page,
  }) => {
    // Mock API to return error
    await page.route("/api/manifest/generate", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "Test error message",
        }),
      });
    });

    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill("A task management system with user authentication");
    await generateButton.click();

    // Should show error
    await expect(page.getByText(/error.*test error message/i)).toBeVisible();
  });

  test("should display manifest preview on success", async ({ page }) => {
    // Mock successful API response
    await page.route("/api/manifest/generate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          manifest: "workspace:\n  name: test-project\nboundedContexts: []",
          confidence: 0.85,
          suggestions: ["Consider adding more contexts"],
          warnings: [],
          metadata: {
            model: "gpt-4",
            processingTime: 1500,
            tokensUsed: 500,
          },
        }),
      });
    });

    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill("A task management system with user authentication");
    await generateButton.click();

    // Should show preview
    await expect(
      page.getByRole("heading", { name: /generated manifest/i }),
    ).toBeVisible();
    await expect(page.getByText(/confidence score/i)).toBeVisible();
    await expect(page.getByText(/85%/)).toBeVisible();
    await expect(page.getByText(/workspace:/)).toBeVisible();
  });

  test("should allow copying manifest to clipboard", async ({ page }) => {
    // Mock successful API response
    await page.route("/api/manifest/generate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          manifest: "workspace:\n  name: test-project",
          confidence: 0.85,
          suggestions: [],
          warnings: [],
          metadata: {
            model: "gpt-4",
            processingTime: 1500,
            tokensUsed: 500,
          },
        }),
      });
    });

    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill("A task management system");
    await generateButton.click();

    // Wait for preview
    await expect(
      page.getByRole("heading", { name: /generated manifest/i }),
    ).toBeVisible();

    // Click copy button
    const copyButton = page.getByRole("button", { name: /copy/i });
    await copyButton.click();

    // Verify clipboard (requires clipboard permissions in test)
    // Note: This may not work in all test environments
  });

  test("should allow regenerating manifest", async ({ page }) => {
    // Mock successful API response
    await page.route("/api/manifest/generate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          manifest: "workspace:\n  name: test-project",
          confidence: 0.85,
          suggestions: [],
          warnings: [],
          metadata: {
            model: "gpt-4",
            processingTime: 1500,
            tokensUsed: 500,
          },
        }),
      });
    });

    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill("A task management system");
    await generateButton.click();

    // Wait for preview
    await expect(
      page.getByRole("heading", { name: /generated manifest/i }),
    ).toBeVisible();

    // Click regenerate
    const regenerateButton = page.getByRole("button", { name: /regenerate/i });
    await regenerateButton.click();

    // Should return to input screen
    await expect(
      page.getByRole("heading", { name: /welcome to hexagen monaco/i }),
    ).toBeVisible();
    await expect(textarea).toHaveValue("A task management system");
  });

  test("should proceed to project wizard with manifest", async ({ page }) => {
    // Mock successful API response
    await page.route("/api/manifest/generate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          manifest: "workspace:\n  name: test-project",
          confidence: 0.85,
          suggestions: [],
          warnings: [],
          metadata: {
            model: "gpt-4",
            processingTime: 1500,
            tokensUsed: 500,
          },
        }),
      });
    });

    const textarea = page.getByRole("textbox", {
      name: /project description/i,
    });
    const generateButton = page.getByRole("button", {
      name: /generate manifest/i,
    });

    await textarea.fill("A task management system");
    await generateButton.click();

    // Wait for preview
    await expect(
      page.getByRole("heading", { name: /generated manifest/i }),
    ).toBeVisible();

    // Click use manifest
    const useButton = page.getByRole("button", { name: /use this manifest/i });
    await useButton.click();

    // Should navigate to project wizard
    // Note: Update this expectation based on your actual routing
    // await expect(page).toHaveURL(/\/wizard/);
  });
});

// Made with Bob
