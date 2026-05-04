import { DOMAIN_COMPASS, getStatCount, getStatItems } from "./lib/utils";
import type { DomainCompassGridProps } from "./types";

export function DomainCompassGrid({
  stats,
  onModalOpen,
}: DomainCompassGridProps) {
  return (
    <div className="grid grid-cols-2 gap-x-10 gap-y-5">
      {DOMAIN_COMPASS.map(({ key, itemsKey, label, Icon, color }) => (
        <button
          key={key}
          type="button"
          className="flex flex-col items-center opacity-70 hover:opacity-100 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          onClick={() => onModalOpen(label, getStatItems(stats, itemsKey))}
          aria-label={`View ${label}`}
        >
          <Icon size={16} className={color} />
          <span className="text-xs uppercase tracking-tighter font-bold text-muted-foreground mt-1">
            {label}
          </span>
          <span className="text-xs font-mono text-foreground">
            {getStatCount(stats, key)}
          </span>
        </button>
      ))}
    </div>
  );
}
