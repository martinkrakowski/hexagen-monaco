import * as readline from "node:readline";

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    // End of input (Ctrl-D, a closed pipe) closes the interface without
    // calling the question's callback: answer "" so the caller's default
    // applies, instead of a promise that never settles.
    rl.once("close", () => resolve(""));
    rl.question(prompt, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
}

export async function confirm(
  message: string,
  options: { default?: boolean; force?: boolean } = {},
): Promise<boolean> {
  if (options.force === true) {
    return true;
  }

  const defaultStr = options.default === true ? "Y/n" : "y/N";
  const answer = await ask(`${message} (${defaultStr}): `);

  const normalized = answer.toLowerCase().trim();

  if (!normalized) {
    return options.default === true;
  }

  return ["y", "yes"].includes(normalized);
}
