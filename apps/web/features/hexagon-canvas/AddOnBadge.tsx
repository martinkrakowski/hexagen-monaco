/**
 * The "⊕" add-on marker. One component so the compass annotation, the strip
 * chips, and the legend render an identical badge (no drift). Colour is the
 * --addon-accent theme token; the glyph is punched out in the card colour for
 * contrast in both light and dark modes.
 */
export function AddOnBadge({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold leading-none ${className}`}
      style={{
        backgroundColor: "hsl(var(--addon-accent))",
        color: "hsl(var(--card))",
      }}
    >
      +
    </span>
  );
}
