const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private interval?: NodeJS.Timeout;
  private message: string = "";
  private index: number = 0;

  private shouldSkip(): boolean {
    if (process.env.CI) {
      return true;
    }
    if (process.env.HEXAGEN_NO_SPIN === "1") {
      return true;
    }
    if (!process.stdout.isTTY) {
      return true;
    }
    const term = process.env.TERM;
    if (term === "dumb" || !term?.includes("xterm")) {
      return true;
    }
    return false;
  }

  start(message: string): void {
    if (this.shouldSkip()) {
      console.log(message);
      return;
    }

    this.message = message;
    this.index = 0;

    this.interval = setInterval(() => {
      const char = SPINNER_CHARS[this.index % SPINNER_CHARS.length];
      process.stdout.write(`\r${char} ${message}`);
      this.index++;
    }, 80);
  }

  succeed(message: string): void {
    this.stop();
    if (this.shouldSkip()) {
      console.log(`✅ ${message}`);
    } else {
      process.stdout.write(`\r✅ ${message}\n`);
    }
  }

  fail(message: string): void {
    this.stop();
    if (this.shouldSkip()) {
      console.error(`❌ ${message}`);
    } else {
      process.stdout.write(`\r❌ ${message}\n`);
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      if (!this.shouldSkip()) {
        process.stdout.write("\r\x1B[K");
      }
    }
  }

  update(message: string): void {
    this.message = message;
    if (!this.shouldSkip()) {
      const char = SPINNER_CHARS[this.index % SPINNER_CHARS.length];
      process.stdout.write(`\r${char} ${message}`);
    }
  }
}

export const spinner = new Spinner();
