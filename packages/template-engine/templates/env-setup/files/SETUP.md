# Setup Guide

First-day guide for getting this project running. Framework: **{framework}**.

## Prerequisites

- Node.js 20+ and a package manager (npm, yarn, or pnpm — commands below use npm).
- `tsx` available to run the TypeScript check script (it ships as a dev
  dependency in most setups; otherwise `npm install -D tsx`).

## First-Time Setup

1. Make sure secrets can't be committed — append the secret-ignore rules to your
   `.gitignore` (keep `.gitignore.hexagen` as the committed reference):
   ```bash
   cat .gitignore.hexagen >> .gitignore
   ```
2. Copy the env reference and fill in your values:
   ```bash
   cp .env.example .env.local
   ```
3. Set every variable annotated `# required` (in `.env.example` and in any
   `.env.<template>.example` file). Plain empty values are optional placeholders.
4. Install dependencies:
   ```bash
   npm install
   ```
5. Register the env check (one-time) by adding this script to `package.json`:
   ```json
   "check:env": "tsx scripts/check-env.ts"
   ```
6. Validate your environment, then start the app:
   ```bash
   npm run check:env
   npm run dev
   ```

Run `npm run check:env` before every demo, CI run, or deploy — it fails with a
clear list of any missing required variables.

## How Environment Validation Works

- `.env.example` is the committed reference; `.env.local` holds your real
  values and is gitignored.
- `src/config/env.server.ts` validates server-only vars with Zod at startup.
  With strict validation on, a missing/invalid var throws immediately with a
  readable message; with it off, it logs a warning and uses defaults.
- `src/config/env.client.ts` validates the public `NEXT_PUBLIC_*` vars. Never
  put a secret in a `NEXT_PUBLIC_` variable — it is shipped to the browser.
- Import typed env via `src/config/env.ts` (`serverEnv` on the server,
  `clientEnv` in the browser).
- **Loading `.env` files:** Next.js and Nitro do this natively. If you chose the
  `dotenv` or `dotenv-expand` loader, a `src/config/load-env.ts` is generated —
  `npm install dotenv` (plus `dotenv-expand` for that option) and `import
  "./config/load-env"` as the very first line of your entrypoint.

## Adding More Variables

Each Hexagen template you install extends this base: it appends its variables to
`.env.example` and its own setup notes. After installing a template, re-run
`cp`-merge any new keys into `.env.local` and `npm run check:env` again.

## Common Issues

| Symptom                              | Cause                                  | Fix                                           |
| ------------------------------------ | -------------------------------------- | --------------------------------------------- |
| Startup throws "validation failed"   | A required var is missing in env       | Read the listed keys; set them in `.env.local` |
| A `NEXT_PUBLIC_` value is undefined  | Set after build, or not prefixed       | Prefix with `NEXT_PUBLIC_` and rebuild         |
| A secret leaked to the browser       | Secret was given a `NEXT_PUBLIC_` name | Rename without the prefix; keep it server-only  |
| `check:env` passes but app still 500s | Var present but wrong value/format     | Check the Zod schema in `src/config/env.server.ts` |
