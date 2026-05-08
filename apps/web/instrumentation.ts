/* eslint-disable no-console */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Use prependListener to run BEFORE Next.js's handler
    // This lets us diagnose the primary rejection before Next.js tries to serialize it
    process.prependListener("unhandledRejection", (reason: unknown) => {
      if (!(reason instanceof Error)) {
        // Not an Error object, let Next.js handle it
        return;
      }

      // Diagnose the primary rejection's structure
      const proto = Object.getPrototypeOf(reason);
      const desc = Object.getOwnPropertyDescriptor(proto, "message");

      // If message is getter-only, safely read it and avoid the mutation error
      if (desc && typeof desc.get === "function" && !desc.set) {
        let messageValue = "";
        try {
          messageValue = String(
            (reason as unknown as Record<string, unknown>).message || "",
          );
        } catch (e) {
          messageValue = `<getter threw: ${e}>`;
        }

        console.error("[PRIMARY unhandledRejection]", {
          name: reason.name,
          constructor: reason.constructor.name,
          messageValue,
          hasGetterOnlyMessage: true,
          stack: reason.stack,
        });

        // Don't re-throw; let this rejection pass through to Next.js
        // but Next.js will now see it without attempting to mutate .message
        // Note: we cannot prevent Next.js's secondary handler from running,
        // but by logging here first, we capture the real stack for debugging
      }
    });
  }
}
