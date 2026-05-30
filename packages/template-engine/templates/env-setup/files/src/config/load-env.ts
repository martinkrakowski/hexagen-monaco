// Loads environment variables from .env files for plain Node entrypoints.
// Next.js and Nitro parse .env natively, so this file is only generated when you
// pick the `dotenv` or `dotenv-expand` loader. Import it first, before anything
// that reads process.env, at your process entrypoint:
//
//   import "./config/load-env";
//
import { config } from "dotenv";

const result = config();

// Set by the env-setup wizard via the `dotenv_tool` answer.
const useDotenvExpand = "{dotenv_tool}" === "dotenv-expand";

if (useDotenvExpand) {
  // dotenv-expand is an optional peer — install it when you choose this loader
  // (`npm install dotenv-expand`). Awaited at the top level so expansion finishes
  // before this module finishes loading — i.e. before any later module reads
  // process.env (a non-awaited import would race against that). The specifier is
  // held in a variable so a project that hasn't installed it still typechecks;
  // expansion is skipped if the module is missing at runtime.
  const moduleName: string = "dotenv-expand";
  try {
    const mod = (await import(moduleName)) as {
      expand: (parsed: typeof result) => unknown;
    };
    mod.expand(result);
  } catch (err) {
    // Tolerate only "dotenv-expand isn't installed" (variables then load without
    // reference expansion). Anything else — a broken install, a syntax/init
    // error, a missing transitive dep — propagates so the misconfiguration
    // surfaces at startup instead of being silently swallowed.
    const code = (err as { code?: string }).code;
    const moduleMissing =
      (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
      err instanceof Error &&
      err.message.includes(moduleName);
    if (!moduleMissing) throw err;
  }
}
