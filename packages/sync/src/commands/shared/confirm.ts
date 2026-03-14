import * as readline from "node:readline";

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
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
