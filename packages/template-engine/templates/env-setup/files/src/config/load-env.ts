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
  // (`npm install dotenv-expand`). The specifier is held in a variable so a
  // project that hasn't installed it still typechecks; variable expansion is
  // simply skipped if the module is missing at runtime.
  const moduleName: string = "dotenv-expand";
  void import(moduleName)
    .then((mod) => {
      (mod as { expand: (parsed: typeof result) => unknown }).expand(result);
    })
    .catch(() => {
      // dotenv-expand not installed — variables load without reference expansion.
    });
}
