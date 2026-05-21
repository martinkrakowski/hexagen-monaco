// UI flow smoke test against a mocked NDJSON stream.
// Does NOT validate the prompt / heuristic fixes — see Phase 4 of docs/planning/stage3-port-leakage-remediation.md for real-LLM verification.
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";

import { fileURLToPath } from "node:url";

test.describe("Loose-Spec Import E2E Flow @smoke", () => {
  test("successfully processes krakowski-portal-with-worker.yaml structured config", async ({
    page,
  }) => {
    // 1. Locate the test fixture path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const workspaceRoot = path.resolve(__dirname, "../../../..");
    const specPath = path.join(
      workspaceRoot,
      "packages/agentic-interaction/__tests__/use-cases/staged-generation/fixtures/krakowski-portal-with-worker.yaml",
    );

    if (!fs.existsSync(specPath)) {
      throw new Error(`Fixture spec file not found at: ${specPath}`);
    }

    // 2. Set up network interception for the staged generation NDJSON stream
    await page.route("**/api/manifest/generate/spec", async (route) => {
      const mockEvents = [
        { type: "stage-start", stage: 0, label: "Parsing Configuration" },
        {
          type: "stage-complete",
          stage: 0,
          label: "Parsing Configuration",
          durationMs: 10,
        },
        { type: "stage-start", stage: 1, label: "Building Domain Model" },
        {
          type: "stage-complete",
          stage: 1,
          label: "Building Domain Model",
          durationMs: 10,
        },
        { type: "stage-start", stage: 2, label: "Classifying Contexts" },
        {
          type: "stage-complete",
          stage: 2,
          label: "Classifying Contexts",
          durationMs: 10,
        },
        { type: "stage-start", stage: 3, label: "Mapping Ports" },
        {
          type: "stage-complete",
          stage: 3,
          label: "Mapping Ports",
          durationMs: 10,
        },
        { type: "stage-start", stage: 4, label: "Assigning Adapters" },
        {
          type: "stage-complete",
          stage: 4,
          label: "Assigning Adapters",
          durationMs: 10,
        },
        { type: "stage-start", stage: 5, label: "Assembling Manifest" },
        {
          type: "stage-complete",
          stage: 5,
          label: "Assembling Manifest",
          durationMs: 10,
        },
        { type: "stage-start", stage: 6, label: "Validating" },
        {
          type: "stage-complete",
          stage: 6,
          label: "Validating",
          durationMs: 10,
        },
        {
          type: "done",
          yaml: `project: krakowski-portal
bounded_contexts:
  - name: IdentityAccess
    type: core
    responsibility: User identity and access management
  - name: CustomerOnboarding
    type: core
    responsibility: Customer onboarding process
    layers:
      application:
        ports:
          in: []
          out: []
  - name: InvoicingBilling
    type: core
    responsibility: Invoicing and billing management
    layers:
      application:
        ports:
          in: []
          out: []
  - name: PaymentProcessing
    type: core
    responsibility: Payment processing via Stripe
  - name: NotificationDelivery
    type: supporting
    responsibility: Notification delivery via email and in-app
  - name: ProjectDelivery
    type: core
    responsibility: Project lifecycle management
  - name: ReportingAnalytics
    type: generic
    responsibility: Reporting and analytics
  - name: DocumentVault
    type: supporting
    responsibility: Contracts, shared files, scoped Supabase Storage
context_mappings: []
`,
          contextCount: 8,
          portCount: 0,
          adapterCount: 0,
          transactionId: "mock-tx-123",
        },
      ];

      const responseBody =
        mockEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: responseBody,
      });
    });

    // 3. Navigate to the import page
    page.on("console", (msg) => console.log("BROWSER LOG:", msg.text()));
    page.on("pageerror", (err) =>
      console.error("BROWSER ERROR:", err.stack || err.message),
    );

    await page.goto("/projects/new/import/spec");
    await page.waitForLoadState("networkidle");

    // 4. Upload the specification file
    const fileInput = page.locator("#project-spec-file");
    await fileInput.waitFor({ state: "visible" });
    // Additional delay to ensure React hydration has fully attached event handlers
    await page.waitForTimeout(1000);
    await fileInput.setInputFiles(specPath);

    // 5. Verify the spec summary view is presented and correct counts are shown
    await expect(page.locator("text=Spec Review")).toBeVisible();
    await expect(
      page.locator("text=8 bounded contexts detected"),
    ).toBeVisible();

    // 6. Click the "Map Ports & Adapters" action button
    const actionButton = page.locator(
      "button:has-text('Map Ports & Adapters')",
    );
    await expect(actionButton).toBeVisible();
    await actionButton.click();

    // 7. Verify the progress view appears and then the preview is shown
    await expect(page.locator("text=Manifest Preview")).toBeVisible({
      timeout: 15000,
    });

    // 8. Extract the generated YAML from the preview block
    const previewBlock = page.locator("pre");
    await expect(previewBlock).toBeVisible();
    const yamlContent = await previewBlock.textContent();
    expect(yamlContent).not.toBeNull();

    // 9. Parse and assert on the manifest structure
    interface BoundedContext {
      name: string;
      type?: string;
      responsibility?: string;
      layers?: {
        application?: {
          ports?: {
            in?: string[];
            out?: string[];
          };
        };
      };
    }

    interface Manifest {
      project?: string;
      bounded_contexts?: BoundedContext[];
    }

    const parsedManifest = yaml.load(yamlContent!) as Manifest;

    expect(parsedManifest.project).toBe("krakowski-portal");

    const contexts = parsedManifest.bounded_contexts || [];

    // Check DocumentVault classification (supporting)
    const docVault = contexts.find((c) => c.name === "DocumentVault");
    expect(docVault).toBeDefined();
    expect(docVault!.type).toBe("supporting");

    // Check CustomerOnboarding does not contain worker-level responsibilities/ports
    const customerOnboarding = contexts.find(
      (c) => c.name === "CustomerOnboarding",
    );
    expect(customerOnboarding).toBeDefined();
    const customerPorts = customerOnboarding!.layers?.application?.ports || {};
    const allCustomerPorts = [
      ...(customerPorts.in || []),
      ...(customerPorts.out || []),
    ];
    for (const port of allCustomerPorts) {
      expect(port).not.toMatch(/email-retry/i);
      expect(port).not.toMatch(/overdue-invoice/i);
      expect(port).not.toMatch(/stripe-reconciliation/i);
      expect(port).not.toMatch(/EmailRetry/i);
      expect(port).not.toMatch(/OverdueInvoice/i);
      expect(port).not.toMatch(/StripeReconciliation/i);
    }

    // Check InvoicingBilling does not contain deployment platform client ports
    const invoicingBilling = contexts.find(
      (c) => c.name === "InvoicingBilling",
    );
    expect(invoicingBilling).toBeDefined();
    const billingPorts = invoicingBilling!.layers?.application?.ports || {};
    const allBillingPorts = [
      ...(billingPorts.in || []),
      ...(billingPorts.out || []),
    ];
    for (const port of allBillingPorts) {
      expect(port).not.toMatch(/vercel/i);
      expect(port).not.toMatch(/fly\.io/i);
      expect(port).not.toMatch(/flyio/i);
      expect(port).not.toMatch(/VercelClient/i);
      expect(port).not.toMatch(/FlyIOClient/i);
    }

    // 10. Save a screenshot to the artifacts directory
    const screenshotDir = path.join(
      __dirname,
      "../../test-results/screenshots",
    );
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(
      screenshotDir,
      "loose_spec_import_preview.png",
    );
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved E2E verification screenshot to ${screenshotPath}`);
  });
});
