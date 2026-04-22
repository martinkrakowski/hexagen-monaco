"use client";

/**
 * Rendered when the wizard reaches the port-configuration step with
 * no bounded contexts defined. Prompts the user to add contexts in
 * the previous step.
 */
export function PortsEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-4">
      <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/30">
        <p className="text-sm text-muted-foreground">
          No bounded contexts available. Add contexts first.
        </p>
      </div>
    </div>
  );
}
