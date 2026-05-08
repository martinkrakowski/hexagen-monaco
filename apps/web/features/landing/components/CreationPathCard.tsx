"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { FileText, Upload, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreationPathOption } from "../domain/creation-path";

const pathCardVariants = cva(
  "group bg-card border rounded-lg p-6 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      colorTheme: {
        success: "border-card-border hover:border-success/40",
        info: "border-card-border hover:border-info/40",
        primary:
          "border-primary/30 hover:border-primary/60 relative overflow-hidden",
      },
    },
    defaultVariants: {
      colorTheme: "success",
    },
  },
);

const iconContainerVariants = cva(
  "w-10 h-10 rounded-md flex items-center justify-center mb-4 transition-colors",
  {
    variants: {
      colorTheme: {
        success: "bg-success/10 group-hover:bg-success/20",
        info: "bg-info/10 group-hover:bg-info/20",
        primary: "bg-primary/15 group-hover:bg-primary/25",
      },
    },
    defaultVariants: {
      colorTheme: "success",
    },
  },
);

const headingVariants = cva("font-bold text-lg mb-2 transition-colors", {
  variants: {
    colorTheme: {
      success: "group-hover:text-success",
      info: "group-hover:text-info",
      primary: "group-hover:text-primary",
    },
  },
  defaultVariants: {
    colorTheme: "success",
  },
});

const iconColorVariants = cva("h-5 w-5", {
  variants: {
    colorTheme: {
      success: "text-success",
      info: "text-info",
      primary: "text-primary",
    },
  },
  defaultVariants: {
    colorTheme: "success",
  },
});

const iconMap = {
  FileText,
  Upload,
  Layers,
} as const;

function PathIcon({
  iconName,
  colorTheme,
}: {
  readonly iconName: string;
  readonly colorTheme: "success" | "info" | "primary";
}) {
  const IconComponent = iconMap[iconName as keyof typeof iconMap] ?? FileText;

  return <IconComponent className={cn(iconColorVariants({ colorTheme }))} />;
}

interface CreationPathCardProps extends VariantProps<typeof pathCardVariants> {
  readonly option: CreationPathOption;
  readonly onSelect: (id: CreationPathOption["id"]) => void;
}

export function CreationPathCard({
  option,
  onSelect,
  colorTheme,
}: CreationPathCardProps) {
  const theme = colorTheme ?? option.colorTheme;

  return (
    <button
      type="button"
      onClick={() => onSelect(option.id)}
      className={cn(
        "active:scale-[0.98]",
        pathCardVariants({ colorTheme: theme }),
      )}
    >
      {theme === "primary" && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer-slow" />
      )}
      <div className={theme === "primary" ? "relative z-10" : ""}>
        <div className={cn(iconContainerVariants({ colorTheme: theme }))}>
          <PathIcon iconName={option.iconName} colorTheme={theme} />
        </div>
        <h3 className={cn(headingVariants({ colorTheme: theme }))}>
          {option.label}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {option.description}
        </p>
      </div>
    </button>
  );
}
