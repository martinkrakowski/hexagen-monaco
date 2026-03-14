import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Manifest } from "@hexagen/sync";
import { validateContextName, checkContextUniqueness } from "./persistence.js";

interface WizardState {
  name: string | null;
  type: "core" | "supporting" | "shared-kernel" | "driver" | null;
  description: string | null;
}

function createWizardState(): WizardState {
  return {
    name: null,
    type: null,
    description: null,
  };
}

const CONTEXT_TYPE_OPTIONS = [
  { value: "core", label: "Core - Domain logic and business rules" },
  { value: "supporting", label: "Supporting - Helper utilities and services" },
  {
    value: "shared-kernel",
    label: "Shared Kernel - Shared types across contexts",
  },
  { value: "driver", label: "Driver - UI or API adapters" },
];

export async function runContextWizard(
  manifest: Manifest,
): Promise<{ name: string; type: string; description?: string } | null> {
  const rl = readline.createInterface({ input, output });

  try {
    console.info("\n🆕 Starting bounded context scaffolding wizard...\n");

    const state = createWizardState();

    // Step 1: Collect context name
    while (!state.name) {
      const answer = await rl.question(
        "Enter context name (snake_case, e.g., user-management): ",
      );

      const validation = validateContextName(answer);

      if (!validation.valid) {
        console.warn("⚠️  Validation errors:");
        validation.errors.forEach((err) => console.warn(`   - ${err}`));
        console.log("");
        continue;
      }

      // Check uniqueness
      const uniqueness = checkContextUniqueness(answer, manifest);
      if (!uniqueness.valid) {
        console.warn(`⚠️  ${uniqueness.errors[0]}`);
        console.log("");
        continue;
      }

      state.name = answer;
    }

    // Step 2: Select context type
    console.info("\nSelect context type:");
    CONTEXT_TYPE_OPTIONS.forEach((ct, i) => {
      console.info(`  ${i + 1}. ${ct.label}`);
    });

    while (!state.type) {
      const answer = await rl.question("Enter number (1-4): ");

      const num = parseInt(answer, 10);
      if (num >= 1 && num <= CONTEXT_TYPE_OPTIONS.length) {
        state.type = CONTEXT_TYPE_OPTIONS[num - 1].value as WizardState["type"];
      } else {
        console.warn("⚠️  Invalid selection. Please enter a number 1-4.");
      }
    }

    // Step 3: Optional description
    const descAnswer = await rl.question(
      "\nEnter description (optional, press Enter to skip): ",
    );

    if (descAnswer && descAnswer.trim()) {
      state.description = descAnswer.trim();
    }

    console.info("\n✅ Collected context definition:");
    console.info(`   Name: ${state.name}`);
    console.info(`   Type: ${state.type}`);
    if (state.description) {
      console.info(`   Description: ${state.description}`);
    }
    console.log("");

    return {
      name: state.name!,
      type: state.type!,
      description: state.description || undefined,
    };
  } finally {
    rl.close();
  }
}
