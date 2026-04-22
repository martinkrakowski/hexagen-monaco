import type { TSESLint } from "@typescript-eslint/utils";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve path from dist/rules/no-kernel-imports.js to <root>/scripts/firewall-blocklist.yaml
const FIREWALL_CONFIG_PATH = path.resolve(
  __dirname,
  "../../../../scripts/firewall-blocklist.yaml",
);

interface FirewallConfig {
  kernel_packages: string[];
}

function getKernelPackages(): string[] {
  try {
    const fileContents = fs.readFileSync(FIREWALL_CONFIG_PATH, "utf8");
    const config = yaml.load(fileContents) as FirewallConfig;
    return config.kernel_packages || [];
  } catch (error) {
    // This is a serious configuration error if it happens, better to fail loud
    throw new Error(
      `HexaGen Firewall: Could not read or parse firewall-blocklist.yaml at ${FIREWALL_CONFIG_PATH}. Error: ${error}`,
    );
  }
}

const KERNEL_PACKAGES = getKernelPackages();

type MessageIds = "kernelImport";

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow kernel-plane imports from UI/projection components (Layer 2 firewall)",
    },
    messages: {
      kernelImport:
        'Import from "{{pkg}}" is forbidden in the UI/projection layer. Use controllers + ports instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        const isKernel = KERNEL_PACKAGES.some(
          (pkg) => source === pkg || source.startsWith(`${pkg}/`),
        );
        if (isKernel) {
          context.report({
            node,
            messageId: "kernelImport",
            data: { pkg: source },
          });
        }
      },
    };
  },
};

export default rule;
