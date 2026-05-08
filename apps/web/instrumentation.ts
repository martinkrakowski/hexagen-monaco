/* eslint-disable no-console */
// Console is intentional here: this file runs in Node.js process before Next.js
// route handling, outside any DI container. Direct console is appropriate.

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Suppress unhandledRejection errors with read-only .message property
    // (e.g., DOMException, TypeError from DOM APIs)
    // These cause Next.js formatServerError to fail with "Cannot set property message"
    process.on("unhandledRejection", (reason: unknown) => {
      if (!(reason instanceof Error)) {
        console.error("[unhandledRejection]", reason);
        return;
      }
      const proto = Object.getPrototypeOf(reason);
      const desc = Object.getOwnPropertyDescriptor(proto, "message");
      if (desc && typeof desc.get === "function" && !desc.set) {
        // Silently suppress — Next.js can't serialize this error anyway
        return;
      }
      console.error("[unhandledRejection]", reason.message, reason.stack);
    });
  }
}
