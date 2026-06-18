/* eslint-disable no-console */
/**
 * Cache-busted Stage-6 latency benchmark. The earlier A/B latencies were
 * contaminated by OpenRouter response caching (repeated identical prompts), so
 * here every request carries a unique nonce to force a cold generation, and we
 * take multiple trials per manifest to report p50/p95 of full-completion wall
 * time — the number that actually blocks the live generation flow.
 *
 * Configs: nemotron @4000 reasoning-on (the Stage-6 candidate) vs gpt-4o @4000
 * (a reasoning-less baseline). Uses cached states from /tmp/ab-states.
 *   npx tsx scripts/nemotron-latency-bench.ts [--only=id,id] [--trials=N]
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import {
  compileStage6Prompt,
  STAGE6_VALIDATION_SYSTEM_PROMPT,
} from "../src/domain/index";
import { EnvironmentSecretVaultAdapter } from "../src/infrastructure/adapters/environment-secret-vault.adapter";
import type { PipelineState } from "../src/domain/value-objects/pipeline-state";

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
const OR_KEY =
  new EnvironmentSecretVaultAdapter().getSecret("STAGE1_REFINER_API_KEY") ?? "";

interface Trial {
  ms: number;
  ok: boolean;
  completion?: number;
  reasoning?: number;
  cachedTokens?: number;
}
async function once(
  model: string,
  system: string,
  user: string,
): Promise<Trial> {
  // Unique nonce → cold generation (defeats response/prompt caching).
  const nonce = `\n\n<!-- cache-bust ${randomUUID()} -->`;
  const t0 = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system + nonce },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });
    const ms = Date.now() - t0;
    const j = await res.json().catch(() => null);
    const content = j?.choices?.[0]?.message?.content ?? "";
    return {
      ms,
      ok: res.ok && !!content,
      completion: j?.usage?.completion_tokens,
      reasoning: j?.usage?.completion_tokens_details?.reasoning_tokens,
      cachedTokens: j?.usage?.prompt_tokens_details?.cached_tokens,
    };
  } catch {
    return { ms: Date.now() - t0, ok: false };
  }
}

function stats(xs: number[]): string {
  if (xs.length === 0) return "n/a";
  const s = [...xs].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  const mean = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return `mean=${mean}ms p50=${p(0.5)}ms p95=${p(0.95)}ms min=${s[0]}ms max=${s[s.length - 1]}ms`;
}

async function main(): Promise<void> {
  const only = process.argv
    .find((a) => a.startsWith("--only="))
    ?.slice(7)
    .split(",");
  const trials =
    Number(process.argv.find((a) => a.startsWith("--trials="))?.slice(9)) || 4;
  const ids = (
    only ?? fs.readdirSync(CACHE_DIR).map((f) => f.replace(/\.json$/, ""))
  ).filter((id) => fs.existsSync(path.join(CACHE_DIR, `${id}.json`)));

  console.log(
    `Stage-6 cache-busted latency — ${trials} trials/manifest, full-completion wall time\nmanifests: ${ids.join(", ")}\n`,
  );

  const configs: Array<{ label: string; model: string }> = [
    {
      label: "nemotron@4000(reason)",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    },
    { label: "gpt-4o@4000(baseline)", model: "openai/gpt-4o" },
  ];
  const allMs: Record<string, number[]> = {};

  for (const id of ids) {
    const state = JSON.parse(
      fs.readFileSync(path.join(CACHE_DIR, `${id}.json`), "utf8"),
    ) as PipelineState;
    const prompt = compileStage6Prompt(state);
    console.log(`━━ ${id} (prompt ${prompt.length} chars)`);
    for (const cfg of configs) {
      const ms: number[] = [];
      let lastTok = "";
      for (let i = 0; i < trials; i++) {
        const t = await once(
          cfg.model,
          STAGE6_VALIDATION_SYSTEM_PROMPT,
          prompt,
        );
        if (t.ok) {
          ms.push(t.ms);
          lastTok = `completion=${t.completion} reasoning=${t.reasoning ?? 0} cached=${t.cachedTokens ?? 0}`;
        } else {
          process.stdout.write(`  (trial ${i + 1} failed/empty ${t.ms}ms) `);
        }
      }
      (allMs[cfg.label] ??= []).push(...ms);
      console.log(`   ${cfg.label.padEnd(24)} ${stats(ms)}  [${lastTok}]`);
    }
  }

  console.log(`\n════════ AGGREGATE (all manifests × trials) ════════`);
  for (const cfg of configs) {
    console.log(
      `${cfg.label.padEnd(24)} n=${allMs[cfg.label]?.length ?? 0}  ${stats(allMs[cfg.label] ?? [])}`,
    );
  }
  console.log(
    `\nStage-6 today (mercury, when it doesn't empty) was ~1.5s in the prod telemetry, for reference.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
