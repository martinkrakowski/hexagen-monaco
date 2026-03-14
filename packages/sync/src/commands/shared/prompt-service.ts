import * as readline from "node:readline";

export class PromptService {
  private rl?: readline.Interface;

  private ensureInterface(): void {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
  }

  isTTY(): boolean {
    return process.stdout.isTTY === true;
  }

  canPrompt(): boolean {
    if (this.isTTY()) {
      return true;
    }
    if (process.env.CI) {
      return false;
    }
    if (process.env.HEXAGEN_NO_PROMPT === "1") {
      return false;
    }
    return false;
  }

  async ask(prompt: string): Promise<string> {
    if (!this.canPrompt()) {
      throw new Error(
        "Cannot prompt in non-interactive environment.\n" +
          "Set $EDITOR to use edit command, or use --force flag.",
      );
    }

    this.ensureInterface();

    return new Promise((resolve) => {
      this.rl!.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async askRequired(prompt: string): Promise<string> {
    while (true) {
      const answer = await this.ask(prompt);
      if (answer.length > 0) {
        return answer;
      }
      console.warn("⚠️ This field is required. Please enter a value.");
    }
  }

  async select(
    prompt: string,
    options: string[],
  ): Promise<{ index: number; value: string }> {
    console.log(prompt);
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt}`);
    });

    while (true) {
      const answer = await this.ask("Select number: ");
      const index = parseInt(answer, 10) - 1;

      if (!isNaN(index) && index >= 0 && index < options.length) {
        return { index, value: options[index] };
      }

      console.warn("⚠️ Invalid selection. Please try again.");
    }
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
  }
}

export const promptService = new PromptService();
