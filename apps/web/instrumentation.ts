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
        return; // swallow — Next.js formatServerError can't handle getter-only .message
      }
      console.error("[unhandledRejection]", reason.message, reason.stack);
    });
  }
}
