interface AiReadyIndicatorProps {
  isReady: boolean;
}

export function AiReadyIndicator({ isReady }: AiReadyIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          "w-2 h-2 rounded-full",
          isReady ? "bg-primary animate-pulse" : "bg-muted-foreground/40",
        ].join(" ")}
      />
      <span className="text-xs font-medium text-muted-foreground">
        {isReady ? "AI Ready" : "No Provider"}
      </span>
    </div>
  );
}
