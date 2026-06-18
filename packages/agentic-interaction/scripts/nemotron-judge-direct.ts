/* eslint-disable no-console */
/**
 * Stage-6 reviewer A/B (direct-API variant). Bypasses the streaming use-case
 * (which returns empty under standalone tsx for both providers) and calls each
 * reviewer model's HTTP API directly with the EXACT Stage-6 system + compiled
 * prompt, so we see raw content, reasoning-token usage, latency, and findings.
 *
 * States are generated once (gpt-4o via OpenRouter) and cached to
 * /tmp/ab-states/<id>.json so judge iterations don't regenerate.
 *
 *   npx tsx scripts/nemotron-judge-direct.ts [--only=id,id]
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { ExecuteFullStagedGenerationUseCase } from "../src/application/use-cases/staged-generation/execute-full-staged-generation.use-case";
import { LLMProviderSelectorAdapter } from "../src/infrastructure/adapters/llm-provider-selector.adapter";
import { EnvironmentSecretVaultAdapter } from "../src/infrastructure/adapters/environment-secret-vault.adapter";
import {
  compileStage6Prompt,
  STAGE6_VALIDATION_SYSTEM_PROMPT,
  normalizeContextName,
} from "../src/domain/index";
import type { PipelineState } from "../src/domain/value-objects/pipeline-state";
import type { PromptVariables } from "../src/domain/prompts/generate-manifest.prompt";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = "/tmp/ab-states";

function loadEnv(p: string): void {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.resolve(SCRIPT_DIR, "../../../apps/web/.env.local"));

const secretVault = new EnvironmentSecretVaultAdapter();

function genAdapter(): LLMProviderSelectorAdapter {
  return new LLMProviderSelectorAdapter({
    webLlmAdapter: null,
    preferLocal: false,
    validateLocalLLM: false,
    fallbackChain: {
      primary: {
        providerId: "openai" as const,
        baseUrl: "https://openrouter.ai/api/v1",
        model: process.env.LLM_MODEL || "openai/gpt-4o",
        apiKeyEnvVar: "STAGE1_REFINER_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
      fallbacks: [],
    },
    secretVault,
  });
}

interface GoldenPrompt {
  id: string;
  description: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

async function getState(p: GoldenPrompt): Promise<PipelineState | null> {
  const cacheFile = path.join(CACHE_DIR, `${p.id}.json`);
  if (fs.existsSync(cacheFile)) {
    process.stdout.write(`(cached state) `);
    return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as PipelineState;
  }
  const vars: PromptVariables = {
    userDescription: p.description,
    platform: p.platform,
    deployment: p.deployment,
    additionalContext: p.additionalContext,
  };
  const useCase = new ExecuteFullStagedGenerationUseCase(
    genAdapter(),
    new InMemoryTransactionManager(),
    undefined,
  );
  const g0 = Date.now();
  const result = await useCase.execute(p.description, vars);
  if (!result.success) {
    console.log(
      `GEN FAILED ${Date.now() - g0}ms: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
    );
    return null;
  }
  process.stdout.write(`gen ${Date.now() - g0}ms `);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result.state));
  return result.state;
}

interface CtxTruth {
  name: string;
  inCount: number;
  hasRepoOut: boolean;
  adapterCount: number;
}
function groundTruth(state: PipelineState): Map<string, CtxTruth> {
  const gt = new Map<string, CtxTruth>();
  for (const ctx of state.stage3?.contexts ?? []) {
    const key = normalizeContextName(ctx.contextName);
    const adapters =
      (state.stage4?.contexts ?? []).find(
        (c) => normalizeContextName(c.contextName) === key,
      )?.adapters ?? [];
    gt.set(key, {
      name: ctx.contextName,
      inCount: ctx.in.length,
      hasRepoOut: ctx.out.some((pp) => pp.type === "repository"),
      adapterCount: adapters.length,
    });
  }
  return gt;
}

interface Finding {
  rule?: string;
  message: string;
  label: "TRUE" | "FALSE_POSITIVE" | "n/a";
}
function parseFindings(
  content: string,
  gt: Map<string, CtxTruth>,
): { errors: Finding[]; warnings: number; resultLine: unknown } {
  const errors: Finding[] = [];
  let warnings = 0;
  let resultLine: unknown = null;
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("```"));
  for (const line of lines) {
    let parsed: { type?: string; rule?: string; message?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type === "result") resultLine = parsed;
    if (parsed.type === "warning") warnings++;
    if (parsed.type === "error" && typeof parsed.message === "string") {
      const rule = parsed.rule?.toUpperCase();
      const ctxName = parsed.message.match(/'([^']+)'/)?.[1];
      let label: Finding["label"] = "n/a";
      if (ctxName) {
        const g = gt.get(normalizeContextName(ctxName));
        if (g && rule === "R02")
          label = g.inCount > 0 ? "FALSE_POSITIVE" : "TRUE";
        if (g && rule === "R03")
          label = g.hasRepoOut ? "FALSE_POSITIVE" : "TRUE";
      }
      errors.push({ rule, message: parsed.message, label });
    }
  }
  return { errors, warnings, resultLine };
}

interface CallResult {
  ok: boolean;
  status: number;
  ms: number;
  content: string;
  completionTokens?: number;
  reasoningTokens?: number;
  cost?: number;
  err?: string;
}
async function callModel(
  url: string,
  key: string,
  model: string,
  userPrompt: string,
  maxTokens: number,
  extra: Record<string, unknown> = {},
): Promise<CallResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: STAGE6_VALIDATION_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
        ...extra,
      }),
    });
    const ms = Date.now() - t0;
    const j = await res.json().catch(() => null);
    const content = j?.choices?.[0]?.message?.content ?? "";
    return {
      ok: res.ok && !!content,
      status: res.status,
      ms,
      content,
      completionTokens: j?.usage?.completion_tokens,
      reasoningTokens: j?.usage?.completion_tokens_details?.reasoning_tokens,
      cost: j?.usage?.cost,
      err: j?.error ? JSON.stringify(j.error).slice(0, 200) : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      content: "",
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

function report(
  label: string,
  r: CallResult,
  gt: Map<string, CtxTruth>,
): { fp: number; tp: number; errs: number } {
  if (!r.ok) {
    console.log(
      `   ${label.padEnd(22)} ✗ HTTP ${r.status} ${r.ms}ms — ${r.err ?? "empty content"} ` +
        `[completion=${r.completionTokens ?? "?"} reasoning=${r.reasoningTokens ?? "?"}]`,
    );
    return { fp: 0, tp: 0, errs: 0 };
  }
  const { errors, warnings, resultLine } = parseFindings(r.content, gt);
  const fp = errors.filter((e) => e.label === "FALSE_POSITIVE").length;
  const tp = errors.filter((e) => e.label === "TRUE").length;
  console.log(
    `   ${label.padEnd(22)} ✓ ${r.ms}ms — ${errors.length} errors / ${warnings} warns ` +
      `[completion=${r.completionTokens ?? "?"} reasoning=${r.reasoningTokens ?? 0} cost=$${r.cost?.toFixed(5) ?? "?"}] ` +
      `FP=${fp} TP=${tp}${resultLine ? "" : " (no result line)"}`,
  );
  for (const e of errors) {
    const mark =
      e.label === "FALSE_POSITIVE"
        ? "❌FP"
        : e.label === "TRUE"
          ? "✓TP"
          : "  ·";
    console.log(`       ${mark} [${e.rule ?? "?"}] ${e.message.slice(0, 120)}`);
  }
  return { fp, tp, errs: errors.length };
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg?.slice(7).split(",");
  const all: GoldenPrompt[] = JSON.parse(
    fs.readFileSync(path.join(SCRIPT_DIR, "golden-prompts.json"), "utf8"),
  );
  const prompts = only ? all.filter((p) => only.includes(p.id)) : all;

  const INC_KEY = secretVault.getSecret("INCEPTION_API_KEY") ?? "";
  const OR_KEY = secretVault.getSecret("STAGE1_REFINER_API_KEY") ?? "";
  console.log(
    `Direct Stage-6 reviewer A/B — mercury-2 (inception) vs nemotron-3-ultra-550b (openrouter)\n` +
      `prompts: ${prompts.map((p) => p.id).join(", ")}\n`,
  );

  const agg = {
    "nemo@4000(reason)": { fp: 0, tp: 0, errs: 0, n: 0, fail: 0 },
    "nemo@1500(no-reason)": { fp: 0, tp: 0, errs: 0, n: 0, fail: 0 },
    "nemo@800(no-reason)": { fp: 0, tp: 0, errs: 0, n: 0, fail: 0 },
  };
  const bump = (
    k: keyof typeof agg,
    r: CallResult,
    g: { fp: number; tp: number; errs: number },
  ) => {
    agg[k].n++;
    if (!r.ok) agg[k].fail++;
    agg[k].fp += g.fp;
    agg[k].tp += g.tp;
    agg[k].errs += g.errs;
  };

  for (const p of prompts) {
    process.stdout.write(`\n━━ ${p.id} — `);
    const state = await getState(p);
    if (!state) continue;
    const gt = groundTruth(state);
    const wf = [...gt.values()].filter(
      (c) => c.inCount > 0 && c.hasRepoOut && c.adapterCount > 0,
    ).length;
    const prompt = compileStage6Prompt(state);
    console.log(
      `${gt.size} contexts, ${wf}/${gt.size} fully well-formed · stage6 prompt ${prompt.length} chars`,
    );

    const NEMO_URL = "https://openrouter.ai/api/v1/chat/completions";
    const NEMO = "nvidia/nemotron-3-ultra-550b-a55b";
    void INC_KEY; // mercury already shown empty 6/6 on the full prompt; skip here

    const n4000 = await callModel(NEMO_URL, OR_KEY, NEMO, prompt, 4000);
    bump("nemo@4000(reason)", n4000, report("nemo @4000 reason-on", n4000, gt));

    // OpenRouter unified reasoning control — disable to see if compact NDJSON
    // fits a small budget (cheaper + viable nearer prod's 800 cap).
    const noReason = { reasoning: { enabled: false } };
    const n1500 = await callModel(
      NEMO_URL,
      OR_KEY,
      NEMO,
      prompt,
      1500,
      noReason,
    );
    bump(
      "nemo@1500(no-reason)",
      n1500,
      report("nemo @1500 no-reason", n1500, gt),
    );

    const n800 = await callModel(NEMO_URL, OR_KEY, NEMO, prompt, 800, noReason);
    bump("nemo@800(no-reason)", n800, report("nemo @800 no-reason", n800, gt));
  }

  console.log(
    `\n════════ SUMMARY (FP = R02/R03 on a context that DOES have the port) ════════`,
  );
  for (const [k, a] of Object.entries(agg)) {
    console.log(
      `${k.padEnd(15)} judged=${a.n} empty/fail=${a.fail} totalErrors=${a.errs} FALSE_POS=${a.fp} TRUE_POS=${a.tp}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
