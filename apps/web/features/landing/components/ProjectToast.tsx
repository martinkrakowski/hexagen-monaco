"use client";

interface ProjectToastProps {
  message: string;
  type: "success" | "destructive";
  visible: boolean;
}

export function ProjectToast({ message, type, visible }: ProjectToastProps) {
  return (
    <div
      className={[
        "fixed bottom-4 right-4 z-50",
        "flex items-center gap-2 px-4 py-3 rounded-md shadow-lg",
        "bg-card text-card-foreground border border-border",
        "text-sm font-medium",
        "transition-all duration-300",
        type === "success" && "border-l-4 border-l-success",
        type === "destructive" && "border-l-4 border-l-destructive",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0 pointer-events-none",
      ]
        .filter(Boolean)
        .join(" ")}
      role="alert"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
