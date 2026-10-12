let registered = false;

export async function register() {
  if (registered) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    registered = true;
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
      console.error("[unhandledRejection]", reason.message, reason.stack);
    });

    const { enforceProductionDatabaseChoice } =
      await import("./lib/platform/production-db-choice");
    enforceProductionDatabaseChoice(process.env);

    if ((process.env.DATABASE_URL ?? "").trim()) {
      const { startPlatformMigrations } =
        await import("./lib/platform/pg-startup");
      await startPlatformMigrations(process.env);
    }
  }
}
