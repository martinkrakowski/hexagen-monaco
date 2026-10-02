// Child process for the concurrency test: appends N lines to the file named in argv.
import { appendChainedLine } from "../../src/node/trace-chain.js";

const [file, who, countText] = process.argv.slice(2);
const count = Number(countText);
for (let i = 0; i < count; i++) {
  await appendChainedLine(file as string, (next) => ({
    ...next,
    who,
    i,
    pad: "x".repeat(2000),
  }));
}
