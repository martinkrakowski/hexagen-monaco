/**
 * Single source of the planning-session chat model. The env expression must
 * stay a LITERAL `process.env.NEXT_PUBLIC_LLM_MODEL` reference — Next.js
 * inlines NEXT_PUBLIC_* at build time by static substitution.
 */
export const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";
