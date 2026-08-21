import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { NoSemanticState } from "@hexagen/ui";

/**
 * The "nothing here yet" surface.
 *
 * Consumers in this arc: a scan that found no packages, a findings list with
 * zero entries, an empty scan history. Two hand-rolled versions already exist
 * (`features/landing/components/ProjectsEmptyState`,
 * `features/project-wizard/steps/port-configuration-step/PortsEmptyState`);
 * neither can be reused across slices (cross-slice imports are fatal), and
 * `@hexagen/ui` has no equivalent, so this is the neutral-home version the
 * brownfield screens compose. Existing slice-local copies are deliberately NOT
 * migrated here -- that is a separate packet with its own blast radius.
 *
 * DESIGN.md 5.2 step 3: no `@hexagen/ui` primitive covers a centred
 * icon/heading/description/action stack, and composing `Card` would impose a
 * bordered surface that the two existing empty states do not have.
 *
 * ACCESSIBILITY: `title` renders as a real heading element, never a styled
 * `div`, so the empty region is reachable by heading navigation and announces
 * as a section rather than as loose text. The level is the caller's to choose
 * because only the caller knows the surrounding document outline; it defaults
 * to `h3`, which is what both existing empty states use.
 *
 * PROP NAMING: no `error` prop, by construction. This directory is
 * presentation-only and `error` is one of the forbidden information-state
 * names (scripts/firewall-blocklist.yaml, enforced by
 * `hexagen-ui/no-information-state` plus check 3 of validate-ui-boundary.sh).
 * A failed scan is a boundary-component concern: the boundary decides what to
 * render and passes finished copy in as `title`/`description`.
 *
 * No `use client` directive: this renders from props with no state, effects or
 * event handlers, so it works as a Server Component (DESIGN.md 5.5). An
 * `action` supplied by a client parent keeps its own boundary.
 */
export type EmptyStateProps = NoSemanticState<{
  /** Short sentence naming what is absent, e.g. "No packages found". */
  title: string;
  /** Optional second line explaining what to do about it. */
  description?: ReactNode;
  /** Optional Lucide icon component (DESIGN.md 2 -- no other icon library). */
  icon?: LucideIcon;
  /** Optional call to action, e.g. a `<Button>` or `<Link>`. */
  action?: ReactNode;
  /**
   * Heading level for `title`. The caller owns this because only the caller
   * knows the surrounding outline. Defaults to 3.
   */
  headingLevel?: 2 | 3 | 4;
  /** Extra classes for the outer container, e.g. layout hints from the host. */
  className?: string;
}>;

/**
 * Level -> intrinsic tag. A lookup keeps the JSX tag a union of literal
 * intrinsic names, which a template string (`h${level}`) would widen to
 * `string` and break under strict JSX typing.
 */
const HEADING_TAGS = {
  2: "h2",
  3: "h3",
  4: "h4",
} as const;

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = HEADING_TAGS[headingLevel];

  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon ? (
        // aria-hidden: the icon is decorative -- `title` already names the
        // state, so announcing the glyph would double the message.
        <Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      ) : null}
      <Heading className="text-lg font-medium text-foreground">{title}</Heading>
      {description ? (
        // text-muted-foreground per DESIGN.md 4.4: helper copy, not a heading.
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
