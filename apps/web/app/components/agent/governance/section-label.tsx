interface SectionLabelProps {
  label: string;
  icon?: React.ComponentType<{
    size: number;
    className: string;
    strokeWidth?: number;
  }>;
}

export function SectionLabel({ label, icon: Icon }: SectionLabelProps) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
        {Icon && <Icon size={10} className="text-primary" strokeWidth={2.5} />}
      </div>
      <h2 className="text-[13px] font-semibold text-foreground">{label}</h2>
    </div>
  );
}
