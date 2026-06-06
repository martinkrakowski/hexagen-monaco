import { useEffect, useState } from "react";

interface SpecConvertingStepProps {
  conversionError: string | null;
  /**
   * Latest server-side liveness message from the conversion stream, if any.
   * Its arrival is what proves the server is still working (a local clock alone
   * keeps ticking even if the backend has died).
   */
  progressMessage?: string | null;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SpecConvertingStep({
  conversionError,
  progressMessage,
}: SpecConvertingStepProps) {
  // Advance a local clock once per second so the UI visibly moves during the
  // (potentially multi-minute) model call. A static spinner reads as a crash;
  // a ticking elapsed time reassures the user that work is in flight. This
  // component only mounts while a conversion is running, so mount === start.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (conversionError) return; // stop the clock once it has failed
    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [conversionError]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Converting...</h2>
      <div className="p-4 bg-muted rounded flex items-center gap-3">
        <div className="animate-spin-border w-5 h-5 rounded-full border-2 border-primary border-t-transparent"></div>
        <div className="flex flex-col">
          <p>
            {progressMessage ??
              "Converting loose specification into structured architecture..."}
          </p>
          {/* Not an aria-live region: a per-second update would make screen
              readers announce the clock every tick. The static reassurance
              copy below conveys "still working" to assistive tech instead. */}
          <p
            className="text-sm text-muted-foreground"
            data-testid="conversion-elapsed"
          >
            Working with the model — {formatElapsed(elapsedSeconds)} elapsed
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Large or complex specifications can take a few minutes. If the model
        gets stuck it will time out on its own and let you retry — the app
        hasn&apos;t frozen.
      </p>
      {conversionError && (
        <div className="mt-4 p-4 bg-destructive/10 text-destructive rounded">
          Error: {conversionError}
        </div>
      )}
    </div>
  );
}
