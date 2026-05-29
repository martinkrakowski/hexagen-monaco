/* eslint-disable no-console */
import * as readline from "node:readline";
import type { QuestionEnginePort } from "../application/ports/question-engine.port.js";
import type { TemplateQuestion, QuestionAnswer } from "../domain/index.js";

export class InteractiveQuestionEngine implements QuestionEnginePort {
  private rl: readline.Interface | null = null;

  private getInterface(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return this.rl;
  }

  private rawAsk(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.getInterface().question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async ask(question: TemplateQuestion): Promise<QuestionAnswer> {
    switch (question.type) {
      case "auto":
        return question.default ?? "";
      case "boolean":
        return this.askBoolean(question.prompt, question.default);
      case "text":
        return this.askText(
          question.prompt,
          question.default,
          question.validation,
          question.required,
        );
      case "select":
        return this.askSelect(
          question.prompt,
          question.options,
          question.default,
        );
      case "multiselect":
        return this.askMultiSelect(
          question.prompt,
          question.options,
          question.default,
        );
    }
  }

  private async askBoolean(
    prompt: string,
    defaultValue?: boolean,
  ): Promise<boolean> {
    const hint =
      defaultValue === true ? "Y/n" : defaultValue === false ? "y/N" : "y/n";
    for (;;) {
      const raw = await this.rawAsk(`${prompt} (${hint}): `);
      if (!raw && defaultValue !== undefined) return defaultValue;
      if (raw.toLowerCase() === "y" || raw.toLowerCase() === "yes") return true;
      if (raw.toLowerCase() === "n" || raw.toLowerCase() === "no") return false;
      console.warn("  ⚠️  Please enter y or n");
    }
  }

  private async askText(
    prompt: string,
    defaultValue?: string,
    validation?: { pattern: string; message: string },
    required?: boolean,
  ): Promise<string> {
    const hint = defaultValue ? ` [${defaultValue}]` : "";
    for (;;) {
      const raw = await this.rawAsk(`${prompt}${hint}: `);
      const value = raw || defaultValue || "";

      if (required && !value) {
        console.warn("  ⚠️  This field is required");
        continue;
      }
      if (validation && value) {
        if (!new RegExp(validation.pattern).test(value)) {
          console.warn(`  ⚠️  ${validation.message}`);
          continue;
        }
      }
      return value;
    }
  }

  private async askSelect(
    prompt: string,
    options: string[],
    defaultValue?: string,
  ): Promise<string> {
    const defaultIndex = defaultValue
      ? options.indexOf(defaultValue) + 1
      : undefined;
    console.log(`\n${prompt}`);
    options.forEach((opt, i) => {
      const marker = opt === defaultValue ? " (default)" : "";
      console.log(`  ${i + 1}. ${opt}${marker}`);
    });
    for (;;) {
      const hint = defaultIndex ? ` [${defaultIndex}]` : "";
      const raw = await this.rawAsk(`  Select${hint}: `);
      if (!raw && defaultValue) return defaultValue;
      const index = parseInt(raw, 10) - 1;
      if (!isNaN(index) && index >= 0 && index < options.length)
        return options[index];
      console.warn(`  ⚠️  Enter a number between 1 and ${options.length}`);
    }
  }

  private async askMultiSelect(
    prompt: string,
    options: string[],
    defaults?: string[],
  ): Promise<string[]> {
    const defaultNums = defaults
      ?.map((d) => options.indexOf(d) + 1)
      .filter((n) => n > 0)
      .join(",");

    console.log(`\n${prompt} (comma-separated numbers)`);
    options.forEach((opt, i) => {
      const marked = defaults?.includes(opt) ? " ✓" : "";
      console.log(`  ${i + 1}. ${opt}${marked}`);
    });
    for (;;) {
      const hint = defaultNums ? ` [${defaultNums}]` : "";
      const raw = await this.rawAsk(`  Select${hint}: `);
      if (!raw && defaults) return defaults;
      if (!raw) return [];

      const parts = raw.split(",").map((s) => s.trim());
      const selected: string[] = [];
      let valid = true;
      for (const part of parts) {
        const index = parseInt(part, 10) - 1;
        if (isNaN(index) || index < 0 || index >= options.length) {
          console.warn(`  ⚠️  '${part}' is not a valid option number`);
          valid = false;
          break;
        }
        selected.push(options[index]);
      }
      if (valid) return selected;
    }
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
