"use client";

import { useId, useRef } from "react";
import type { ComponentType, KeyboardEvent } from "react";
import { badgeVariants } from "@hexagen/ui";
import type { NoSemanticState } from "@hexagen/ui";

/**
 * ChoiceCardGroup — a radio-card picker.
 *
 * WHY A CUSTOM COMPONENT (DESIGN.md §5.2 step 4): `@hexagen/ui` ships a single
 * `Checkbox` and no radio primitive at all, so there is nothing to use as-is
 * and nothing to compose into single-choice semantics. What it does compose is
 * `badgeVariants` for the optional badge strip, so the pill keeps the shared
 * token definition (§4.6 `--badge-*`) instead of a second hand-rolled one.
 *
 * The markup is lifted from the inline `role="radiogroup"` block in
 * `features/export/PublishSettingsDialog.tsx` — module-level option array,
 * `<label>`-wrapped native `<input type="radio">`, `border-primary bg-primary/5`
 * for the selected card, `cursor-not-allowed opacity-50` for an unavailable
 * one, and an unavailable card swapping its supporting copy for the reason it
 * cannot be picked. That file is a feature slice, so the pattern is COPIED, not
 * imported: check 7 of scripts/validate-ui-boundary.sh fails any import from
 * `features/` into a neutral home directory such as `components/`.
 *
 * Presentation-only: it renders the options it is handed and raises one intent.
 * It owns no selection state, so the caller decides what a pick means.
 */

export interface ChoiceCardOption<TValue extends string = string> {
  /** Stable identity of the choice; also the radio input's value. */
  value: TValue;
  /** Card heading. */
  label: string;
  /** Supporting copy under the heading. */
  description: string;
  /** Renders the card unpickable — the input is genuinely `disabled`. */
  disabled?: boolean;
  /**
   * Shown in place of `description` while the option is unavailable, so the
   * card explains itself rather than just going grey.
   */
  unavailableReason?: string;
  /** Optional pill beside the heading (e.g. a "leaves your machine" strip). */
  badge?: string;
  /** Optional caution line under the supporting copy. */
  warning?: string;
  /** Lucide icon component (DESIGN.md §2 — Lucide React only). */
  Icon?: ComponentType<{ className?: string }>;
}

/**
 * Every prop name here is checked against the eleven names the
 * information-state firewall rejects (scripts/firewall-blocklist.yaml, mirrored
 * by `hexagen-ui/no-information-state` and check 3 of
 * scripts/validate-ui-boundary.sh). Note `disabled`/`unavailableReason` rather
 * than the obvious availability word on that blocklist: availability here is an
 * interaction concern, and it is spelled with an interaction word.
 */
export type ChoiceCardGroupProps<TValue extends string = string> =
  NoSemanticState<{
    /**
     * Accessible name for the group. Required — a nameless radiogroup is a pile
     * of anonymous radios to a screen reader.
     */
    label: string;
    /** Optional hint rendered above the cards and wired up as the group's description. */
    description?: string;
    options: readonly ChoiceCardOption<TValue>[];
    /** The picked value, or `null` when nothing is picked yet. */
    value: TValue | null;
    onSelect: (next: TValue) => void;
    /**
     * Shared `name` for the radio inputs. Defaults to a `useId()` value so two
     * groups on one page cannot capture each other's inputs.
     */
    name?: string;
    className?: string;
  }>;

export function ChoiceCardGroup<TValue extends string = string>({
  label,
  description,
  options,
  value,
  onSelect,
  name,
  className,
}: ChoiceCardGroupProps<TValue>) {
  const generatedId = useId();
  const groupName = name ?? `choice-card-group-${generatedId}`;
  const descriptionId = `${generatedId}-description`;
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Positions of the pickable cards, in render order. Arrow-key movement walks
  // THIS list rather than `options`, which is what makes an unavailable card
  // invisible to the keyboard instead of a dead stop in the middle of the group.
  const pickable = options.reduce<number[]>((acc, option, index) => {
    if (!option.disabled) acc.push(index);
    return acc;
  }, []);

  const selectedIndex = options.findIndex(
    (option) => option.value === value && !option.disabled,
  );

  // Roving tabindex: exactly one card is in the tab order — the picked one, or
  // the first pickable card when nothing is picked yet. Tab enters and leaves
  // the group as a single stop; arrows move within it (WAI-ARIA radiogroup).
  const rovingIndex =
    selectedIndex >= 0 ? selectedIndex : pickable.length > 0 ? pickable[0] : -1;

  const moveTo = (fromIndex: number, delta: number) => {
    if (pickable.length === 0) return;
    const position = pickable.indexOf(fromIndex);
    // `fromIndex` is always pickable (a disabled input receives no key events),
    // but start from the first card rather than wrapping off a -1 if that ever
    // stops being true.
    const nextPosition =
      position < 0 ? 0 : (position + delta + pickable.length) % pickable.length;
    // `nextPosition` is in range because `pickable` is non-empty (guarded
    // above) and the modulo is taken over its own length, so `targetIndex` is
    // always a real index into `options`.
    const targetIndex = pickable[nextPosition];
    inputRefs.current[targetIndex]?.focus();
    onSelect(options[targetIndex].value);
  };

  const handleKeyDown =
    (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
      // Native radio groups do this in the browser, but only for inputs sharing
      // a `name` — and jsdom implements none of it, so the behaviour would be
      // untestable as well as unenforced. Handling the keys explicitly also lets
      // movement skip unavailable cards, which the native behaviour does for
      // `disabled` inputs and which we now own rather than inherit.
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        moveTo(index, 1);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        moveTo(index, -1);
      }
    };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      className={["space-y-2", className].filter(Boolean).join(" ")}
    >
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}

      {options.map((option, index) => {
        const unavailable = option.disabled === true;
        const selected = option.value === value && !unavailable;
        return (
          <label
            key={option.value}
            className={[
              "flex items-start gap-3 rounded-lg border p-4 text-sm transition-colors",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
              selected
                ? "border-primary bg-primary/5"
                : "border-input hover:bg-accent",
              unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            ].join(" ")}
          >
            <input
              ref={(node) => {
                inputRefs.current[index] = node;
              }}
              type="radio"
              name={groupName}
              value={option.value}
              checked={selected}
              disabled={unavailable}
              tabIndex={index === rovingIndex ? 0 : -1}
              onChange={() => {
                // Belt-and-braces alongside the `disabled` attribute above: the
                // attribute is what makes the card genuinely unpickable, this
                // guard is what keeps it unpickable if a caller ever renders the
                // input through a wrapper that drops the attribute.
                if (!unavailable) onSelect(option.value);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={handleKeyDown(index)}
            />
            {option.Icon ? (
              <option.Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : null}
            <span className="min-w-0 space-y-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{option.label}</span>
                {option.badge ? (
                  // `badgeVariants` rather than `<Badge>`: Badge renders a
                  // <div>, and a <label>'s content model is phrasing content
                  // only. Same tokens, valid nesting.
                  <span className={badgeVariants({ variant: "outline" })}>
                    {option.badge}
                  </span>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">
                {unavailable
                  ? (option.unavailableReason ?? option.description)
                  : option.description}
              </span>
              {option.warning ? (
                <span className="block text-xs text-warning">
                  {option.warning}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
