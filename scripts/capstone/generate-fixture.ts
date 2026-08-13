/**
 * Capstone helper: generate a fixture project the exact way the cloud wizard
 * does — scripted wizard answers → `wizardToManifest()` → the REAL
 * `ExternalSyncEngineAdapter` (SyncEngine, external mode) → sync-integrity
 * workflow injection → in-memory add-on materialization (template-overrides-
 * core). No static fixture manifests are checked in: the wizard answers below
 * are the fixture, so emission-default regressions (F2/F8/F15) reproduce here
 * instead of hiding behind a hand-maintained manifest.
 *
 * Fixtures:
 *   monolith-15     15 bounded contexts (+ auto-added shared) on the
 *                   modular-monolith template, Next.js web + Nitro api —
 *                   the F2/F8/F15 reproduction surface.
 *   minimal-addons  1 bounded context + 5 add-on templates (env-setup,
 *                   eslint-no-console, ci-github-actions, bullmq,
 *                   rate-limiting) — the F3/F9/F19/F21 surface.
 *
 *   tsx scripts/capstone/generate-fixture.ts <monolith-15|minimal-addons> <targetDir>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ProjectSpecSchema } from "../../packages/project-configuration/src/schema.js";
import type { WizardData } from "../../packages/project-configuration/src/schema.js";
import { wizardToManifest } from "../../packages/wizard-orchestration/src/application/wizard-to-manifest.js";
import { ExternalSyncEngineAdapter } from "../../packages/project-generation/src/infrastructure/adapters/external-sync-engine.adapter.js";
import {
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
  shouldInjectSyncIntegrityWorkflow,
} from "../../packages/project-generation/src/domain/sync-integrity-workflow.js";
import { createInMemoryMaterializer } from "../../packages/template-engine/src/in-memory.js";
import type { Manifest } from "../../packages/sync/src/index.js";

type BoundedContextInput = WizardData["boundedContexts"][number];

/** Compact context spec expanded into a full wizard BoundedContext. */
interface ContextSpec {
  name: string;
  description: string;
  infra: "nitro" | "plain-ts" | "express" | "none";
  ui?: "Next.js";
  entities?: string[];
  valueObjects?: string[];
  domainEvents?: string[];
  useCases?: string[];
  inbound?: Array<
    "rest-controller" | "graphql-resolver" | "event-listener" | "cli-command"
  >;
  outbound?: Array<
    | "relational-db"
    | "document-db"
    | "external-service-client"
    | "message-publisher"
  >;
  persistence?: "Prisma" | "Drizzle";
}

function toBoundedContext(spec: ContextSpec): BoundedContextInput {
  return {
    id: `${spec.name}-id`,
    name: spec.name,
    description: spec.description,
    infrastructureTarget: spec.infra,
    coreDomainEntities: spec.entities ?? [],
    valueObjects: spec.valueObjects ?? [],
    domainEvents: spec.domainEvents ?? [],
    useCases: spec.useCases ?? [],
    portConfiguration: {
      inboundPorts: spec.inbound ?? [],
      outboundPorts: spec.outbound ?? [],
    },
    uiFramework: spec.ui ?? "",
    persistenceAdapter: spec.persistence ?? "",
    messagingAdapter: "",
    telemetryProvider: "",
  } as BoundedContextInput;
}

// 15 contexts, deliberately varied: some UI-bearing (→ shared Next.js web app
// under modular-monolith), one Nitro (→ the aggregated api app becomes Nitro,
// exercising the F15 framework build outputs), entities/VOs/events/ports/
// use-cases spread around so stubs, barrels and adapters all materialize.
const MONOLITH_CONTEXTS: ContextSpec[] = [
  {
    name: "catalog",
    description: "Product catalog",
    infra: "nitro",
    ui: "Next.js",
    entities: ["Product", "Category"],
    valueObjects: ["Sku"],
    domainEvents: ["ProductListed"],
    useCases: ["ListProduct", "RetireProduct"],
    inbound: ["rest-controller"],
    outbound: ["relational-db"],
    persistence: "Prisma",
  },
  {
    name: "orders",
    description: "Order lifecycle",
    infra: "plain-ts",
    ui: "Next.js",
    entities: ["Order", "OrderLine"],
    valueObjects: ["OrderId"],
    domainEvents: ["OrderPlaced"],
    useCases: ["PlaceOrder", "CancelOrder"],
    inbound: ["rest-controller"],
    outbound: ["relational-db", "message-publisher"],
    persistence: "Prisma",
  },
  {
    name: "billing",
    description: "Invoicing",
    infra: "plain-ts",
    entities: ["Invoice"],
    valueObjects: ["Money"],
    domainEvents: ["InvoiceIssued"],
    useCases: ["IssueInvoice"],
    inbound: ["event-listener"],
    outbound: ["relational-db"],
  },
  {
    name: "payments",
    description: "Payment processing",
    infra: "plain-ts",
    entities: ["Payment"],
    valueObjects: ["CardToken"],
    useCases: ["CapturePayment"],
    inbound: ["rest-controller"],
    outbound: ["external-service-client"],
  },
  {
    name: "inventory",
    description: "Stock levels",
    infra: "plain-ts",
    entities: ["StockItem"],
    useCases: ["AdjustStock"],
    inbound: ["event-listener"],
    outbound: ["relational-db"],
    persistence: "Drizzle",
  },
  {
    name: "shipping",
    description: "Fulfilment",
    infra: "plain-ts",
    entities: ["Shipment"],
    domainEvents: ["ShipmentDispatched"],
    useCases: ["DispatchShipment"],
    outbound: ["message-publisher"],
  },
  {
    name: "customers",
    description: "Customer profiles",
    infra: "plain-ts",
    ui: "Next.js",
    entities: ["Customer"],
    valueObjects: ["EmailAddress"],
    useCases: ["RegisterCustomer"],
    inbound: ["rest-controller"],
    outbound: ["relational-db"],
    persistence: "Prisma",
  },
  {
    name: "identity",
    description: "AuthN/AuthZ",
    infra: "plain-ts",
    entities: ["Account"],
    valueObjects: ["PasswordHash"],
    useCases: ["Authenticate"],
    inbound: ["rest-controller"],
    outbound: ["document-db"],
  },
  {
    name: "notifications",
    description: "Outbound messaging",
    infra: "plain-ts",
    useCases: ["SendNotification"],
    inbound: ["event-listener"],
    outbound: ["external-service-client"],
  },
  {
    name: "analytics",
    description: "Usage analytics",
    infra: "plain-ts",
    entities: ["EventRecord"],
    useCases: ["RecordEvent"],
    inbound: ["event-listener"],
    outbound: ["document-db"],
  },
  {
    name: "search",
    description: "Search indexing",
    infra: "plain-ts",
    useCases: ["ReindexCatalog"],
    inbound: ["event-listener"],
    outbound: ["external-service-client"],
  },
  {
    name: "reviews",
    description: "Product reviews",
    infra: "plain-ts",
    ui: "Next.js",
    entities: ["Review"],
    valueObjects: ["Rating"],
    useCases: ["SubmitReview"],
    inbound: ["rest-controller"],
    outbound: ["relational-db"],
  },
  {
    name: "promotions",
    description: "Discounts and campaigns",
    infra: "plain-ts",
    entities: ["Campaign"],
    valueObjects: ["DiscountCode"],
    useCases: ["ApplyDiscount"],
    inbound: ["rest-controller"],
    outbound: ["relational-db"],
  },
  {
    name: "support",
    description: "Customer support tickets",
    infra: "plain-ts",
    entities: ["Ticket"],
    useCases: ["OpenTicket"],
    inbound: ["rest-controller"],
    outbound: ["relational-db"],
  },
  {
    name: "reporting",
    description: "Back-office reporting",
    infra: "plain-ts",
    useCases: ["GenerateReport"],
    inbound: ["cli-command"],
    outbound: ["document-db"],
  },
];

const FIXTURES: Record<string, () => WizardData> = {
  "monolith-15": () =>
    ProjectSpecSchema.parse({
      governance: {
        workspaceName: "vellum-monolith",
        workspaceTemplate: "modular-monolith",
        packageManager: "yarn",
        namespacePrefix: "@vellum",
      },
      boundedContexts: MONOLITH_CONTEXTS.map(toBoundedContext),
      // In-process peer edges (modular-monolith keeps them as depends_on).
      peerMappings: [
        {
          consumerContext: "orders-id",
          providerContext: "catalog-id",
          integrationPattern: "open-host",
          communicationBoundary: "in-process",
        },
        {
          consumerContext: "billing-id",
          providerContext: "orders-id",
          integrationPattern: "open-host",
          communicationBoundary: "in-process",
        },
        {
          consumerContext: "shipping-id",
          providerContext: "orders-id",
          integrationPattern: "acl",
          communicationBoundary: "in-process",
        },
        {
          consumerContext: "search-id",
          providerContext: "catalog-id",
          integrationPattern: "acl",
          communicationBoundary: "in-process",
        },
      ],
    }),
  "minimal-addons": () =>
    ProjectSpecSchema.parse({
      governance: {
        workspaceName: "vellum-minimal",
        workspaceTemplate: "modular-monolith",
        packageManager: "yarn",
        namespacePrefix: "@vmin",
      },
      boundedContexts: [
        toBoundedContext({
          name: "ledger",
          description: "Double-entry ledger",
          infra: "plain-ts",
          entities: ["LedgerEntry"],
          valueObjects: ["Money"],
          useCases: ["RecordEntry"],
          inbound: ["rest-controller"],
          outbound: ["relational-db"],
          persistence: "Prisma",
        }),
      ],
      peerMappings: [],
      // bullmq + rate-limiting both `require` env-setup; ci-github-actions
      // brings the F21 workflows; three committed `.env*.example` files land
      // on disk (env-setup, bullmq, rate-limiting) for the F3 staged-count
      // gate. All answers default (the wizard's DefaultingQuestionEngine).
      addOnsAnswers: {
        "env-setup": {},
        "eslint-no-console": {},
        "ci-github-actions": {},
        bullmq: {},
        "rate-limiting": {},
      },
    }),
};

async function main(): Promise<void> {
  const [fixtureName, targetDir] = process.argv.slice(2);
  const makeFixture = fixtureName ? FIXTURES[fixtureName] : undefined;
  if (!makeFixture || !targetDir) {
    console.error(
      `usage: generate-fixture.ts <${Object.keys(FIXTURES).join("|")}> <targetDir>`,
    );
    process.exit(1);
  }

  const wizardData = makeFixture();
  const manifest = wizardToManifest(wizardData) as Manifest;

  // 1. Core generation — the same adapter+config the cloud wizard uses.
  const adapter = new ExternalSyncEngineAdapter();
  const genResult = await adapter.generateAt(targetDir, manifest);
  if (!genResult.success) {
    console.error(`generateAt failed: ${genResult.error.message}`);
    process.exit(1);
  }

  // 2. Sync-integrity workflow injection (mirrors GenerateProjectUseCase).
  if (shouldInjectSyncIntegrityWorkflow(manifest.monorepo?.packageManager)) {
    const dest = path.join(targetDir, SYNC_INTEGRITY_WORKFLOW_PATH);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, SYNC_INTEGRITY_WORKFLOW, "utf-8");
  }

  // 3. Add-on materialization, template-overrides-core (mirrors
  //    GenerateProjectUseCase.mergeAddOnFilesIntoTempDir minus the
  //    request-derived-path guards — these paths come from the bundled
  //    templates, not user input).
  const addOnsAnswers = wizardData.addOnsAnswers ?? {};
  if (Object.keys(addOnsAnswers).length > 0) {
    const materializer = createInMemoryMaterializer();
    const { files, warnings, errors } = await materializer.materialize(
      addOnsAnswers,
      { projectName: manifest.system as string },
    );
    if (errors.length > 0) {
      console.error(`add-on materialization errors:\n${errors.join("\n")}`);
      process.exit(1);
    }
    for (const warning of warnings) console.warn(`materializer: ${warning}`);
    for (const [rel, content] of files) {
      const dest = path.join(targetDir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content, "utf-8");
    }
    console.log(`materialized ${files.size} add-on file(s)`);
  }

  console.log(`fixture ${fixtureName} generated at ${targetDir}`);
}

await main();
