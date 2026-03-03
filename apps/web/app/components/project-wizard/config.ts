import { z } from 'zod';

export const persistenceAdapterOptions = [
  'Prisma',
  'TypeORM',
  'Mongoose',
  'Drizzle',
] as const;
export const messagingAdapterOptions = [
  'BullMQ',
  'Temporal',
  'RabbitMQ',
] as const;
export const telemetryProviderOptions = [
  'OpenTelemetry',
  'Prometheus',
  'Winston',
] as const;
export const apiFrameworkOptions = ['NestJS', 'Fastify', 'Express'] as const;
export const uiFrameworkOptions = [
  'Next.js',
  'Remix',
  'React Router 7',
  'Vue.js',
  'Angular',
] as const;

// Helper to handle textarea string-to-array conversion
const stringToArray = z.preprocess((val) => {
  if (typeof val !== 'string') return val;
  return val
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}, z.array(z.string()));

export const projectConfigSchema = z.object({
  withLlm: z.boolean().default(false),
  withBlockchain: z.boolean().default(false),
  // Preprocess select-multiple values to ensure they stay as arrays
  llmProviders: z.array(z.string()).default([]),
  blockchainNetworks: z.array(z.string()).default([]),
  rootName: z
    .string()
    .min(2, { message: 'Project name must be at least 2 characters.' }),
  workspaceScope: z
    .string()
    .min(2, { message: 'Organization scope must be at least 2 characters.' }),
  contextName: z
    .string()
    .min(2, { message: 'Context name must be at least 2 characters.' }),
  entities: stringToArray.refine((arr) => arr.length > 0, {
    message: 'Please define at least one entity.',
  }),
  useCases: stringToArray.refine((arr) => arr.length > 0, {
    message: 'Please define at least one use case.',
  }),
  externalApiPorts: z.array(z.string()).optional().default([]),
  persistenceAdapter: z.enum(persistenceAdapterOptions),
  messagingAdapter: z.enum(messagingAdapterOptions),
  telemetryProvider: z.enum(telemetryProviderOptions),
  apiFramework: z.enum(apiFrameworkOptions),
  uiFramework: z.enum(uiFrameworkOptions),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const emptyFormValues: ProjectConfig = {
  withLlm: false,
  withBlockchain: false,
  llmProviders: [],
  blockchainNetworks: [],
  rootName: 'HexagenProject',
  workspaceScope: '',
  contextName: '',
  entities: [],
  useCases: [],
  externalApiPorts: [],
  persistenceAdapter: 'Prisma',
  messagingAdapter: 'BullMQ',
  telemetryProvider: 'OpenTelemetry',
  apiFramework: 'NestJS',
  uiFramework: 'Next.js',
};

export const projectAddons = [
  {
    id: 'withLlm' as const,
    title: 'LLM-Optimized Hexagonal Project',
    description:
      'Add-on for multi-LLM apps. Adds provider-agnostic ports, orchestration, fallback/routing, and adapters for OpenAI, Grok, Claude, Gemini, Ollama, etc.',
  },
  {
    id: 'withBlockchain' as const,
    title: 'Blockchain-Optimized Hexagonal Project',
    description:
      'Add-on for multi-chain apps. Adds chain-agnostic ports for reading/writing, events, contract calls, wallets, and RPCs. Presets for Ethereum, Solana, Cosmos, Aptos, and more.',
  },
];

export const llmProviderOptions = [
  'OpenAI',
  'Anthropic',
  'Grok',
  'Gemini',
  'MistralAI',
  'Replicate',
  'Ollama',
  'LocalAI',
  'vLLM',
  'LM Studio',
  'Jan',
  'AnythingLLM',
  'llamafile',
  'llama.cpp',
  'node-llama-cpp',
  'llama-node',
  'llamajs',
  'WebLLM',
  'Transformers.js',
  'GPT4All',
  'LiteLLM',
  'TensorRT-LLM',
  'mistral.rs',
];

export const blockchainNetworkOptions = [
  'Arbitrum',
  'Bitcoin',
  'BNB Chain',
  'Cosmos',
  'Ethereum',
  'Polkadot',
  'Polygon',
  'Solana',
  'Stacks',
  'Stellar',
  'Sui',
];

export const wizardSteps = [
  {
    id: 'project_type',
    title: 'Project Type',
    description:
      'Start with a general-purpose project and add specialized components.',
    fields: ['withLlm', 'withBlockchain'],
  },
  {
    id: 'llm_config',
    title: 'LLM Provider Configuration',
    description: 'Choose the LLM providers you want to integrate.',
    fields: ['llmProviders'],
    // --- FIX: Accept ProjectConfig instead of any ---
    condition: (values: ProjectConfig) => values.withLlm,
  },
  {
    id: 'blockchain_config',
    title: 'Blockchain Network Configuration',
    description: 'Choose the blockchain networks you want to support.',
    fields: ['blockchainNetworks'],
    // --- FIX: Accept ProjectConfig instead of any ---
    condition: (values: ProjectConfig) => values.withBlockchain,
  },
  {
    id: 'workspace',
    title: 'Workspace Identity',
    description: "Define your project's name and monorepo scope.",
    fields: ['rootName', 'workspaceScope', 'contextName'],
  },
  {
    id: 'drivers',
    title: 'Inbound Drivers (Apps)',
    description:
      'Select the frameworks for your primary entry points (API and UI).',
    fields: ['apiFramework', 'uiFramework'],
  },
  {
    id: 'adapters',
    title: 'Outbound Adapters',
    description:
      'Choose implementations for data persistence, messaging, and observability.',
    fields: ['persistenceAdapter', 'messagingAdapter', 'telemetryProvider'],
  },
  {
    id: 'core',
    title: 'Hexagon Core',
    description: 'Define the core business logic of your application.',
    fields: ['entities', 'useCases', 'externalApiPorts'],
  },
];
