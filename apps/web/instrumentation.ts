/* eslint-disable no-console */
// Console is intentional here: this file runs in Node.js process before Next.js
// route handling, outside any DI container. Direct console is appropriate.

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.on("unhandledRejection", (reason: unknown) => {
      if (!(reason instanceof Error)) {
        console.error("[unhandledRejection]", reason);
        return;
      }
      const proto = Object.getPrototypeOf(reason);
      const desc = Object.getOwnPropertyDescriptor(proto, "message");
      if (desc && typeof desc.get === "function" && !desc.set) {
        return;
      }
      console.error("[unhandledRejection]", reason);
    });
  }
}
