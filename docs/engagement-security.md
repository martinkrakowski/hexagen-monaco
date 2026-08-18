# Engagement security one-pager

What an FDE can say honestly on day one. This is a data-flow truth table, not a
marketing page.

## Day-one motion is local and deterministic

The engagement kit (lint, adopt, bootstrap, report, the committed baseline)
runs on the customer's machine. Nothing is sent anywhere. That is the default.

LLM-touching paths exist, are named below, and are **off by default** in
engagement mode. Hexagen does **not** claim an air-gap product.

## Local / deterministic (no network)

| Surface                                                 | What it reads                                           | What it writes                                       | Network                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `hexagen-lint` / `hexagen-lint --ratchet`               | manifest, layout (if present), source, baseline         | none (or the baseline file with `--update-baseline`) | none                                                                               |
| `hexagen sync --check`                                  | workspace + manifest                                    | none                                                 | none                                                                               |
| `hexagen report` / `hexagen report --handoff`           | manifest, layout, baseline, git history of the baseline | local HTML/Markdown (and a zip)                      | none (Mermaid in the HTML loads a CDN **only if** the HTML is opened in a browser) |
| Baseline file (`.architecture/arch-lint-baseline.json`) | committed JSON                                          | committed JSON                                       | none                                                                               |
| `hexagen adopt` / `hexagen bootstrap`                   | local tree                                              | local `manifest.yaml` / `layout.yaml` / baseline     | none, unless `--llm` is passed (not default)                                       |

## Named LLM paths (optional)

| Path                                               | Where the prompt goes     | Key custody                                       | Notes                                                                                                                                                   |
| -------------------------------------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud generation (OpenRouter / server-paid models) | Hexagen server → provider | Server-held provider key                          | Metered. This is the hosted product, not the FDE kit.                                                                                                   |
| BYOK chat / generation                             | Hexagen server → provider | Client-held key, encrypted at rest in the browser | **Server-side proxy** (ADR-0030). The key is never stored in plaintext on the server, but **prompts transit Hexagen's server**. This is not an air-gap. |
| Browser WebLLM (`preferLocal` success)             | Stays in the browser      | No server key                                     | `useStagedManifestGeneration` runs the client use case with **no HTTP call**. This is the only LLM path that does not transit Hexagen.                  |
| `/api/manifest/generate/local` fallback            | Hexagen server            | Same as cloud if local cannot run                 | Used when WebLLM cannot run. **Server-mediated.** Do not describe the HTTP route as "local-only".                                                       |

## BYOK in one sentence

BYOK is a **server-side proxy** (ADR-0030, "BYOK Server-Proxy Encryption"):
the API key is client-held and encrypted; decryption happens on the server for
the duration of the request so the server can call the provider. Prompts
transit Hexagen. Never describe BYOK as air-gapped, on-prem-only, or
"the key never leaves the laptop."

## Honest sentence for procurement

The day-one FDE motion (lint / adopt / report / baseline) is deterministic and
local. Optional LLM features are named and off by default in engagement mode.
Successful in-browser WebLLM (`preferLocal`) does not call Hexagen's server.
Server-mediated and fallback paths — including BYOK and
`/api/manifest/generate/local` — go through Hexagen's server.
