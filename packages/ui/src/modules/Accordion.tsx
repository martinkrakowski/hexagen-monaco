"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";

// ─── Root context ──────────────────────────────────────────────────────────────

interface AccordionContextValue {
  isOpen: (value: string) => boolean;
  toggle: (value: string) => void;
  /** Per-Root unique prefix so trigger/panel ids don't collide when two
   * Accordion.Root instances reuse the same item value on one page. */
  triggerId: (value: string) => string;
  contentId: (value: string) => string;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function useAccordionContext(): AccordionContextValue {
  const ctx = useContext(AccordionContext);
  if (!ctx)
    throw new Error(
      "Accordion subcomponents must be used inside <Accordion.Root>",
    );
  return ctx;
}

// ─── Item context ──────────────────────────────────────────────────────────────

const AccordionItemContext = createContext<string | null>(null);

function useAccordionItemContext(): string {
  const value = useContext(AccordionItemContext);
  if (value === null)
    throw new Error(
      "Accordion.Trigger and Accordion.Content must be used inside <Accordion.Item>",
    );
  return value;
}

// ─── Root ───────────────────────────────────────────────────────────────────────

type RootProps = {
  children: ReactNode;
  className?: string;
} & (
  | {
      /** Only one item open at a time. `collapsible` (default true) allows the
       * open item to close, leaving none open. */
      type?: "single";
      collapsible?: boolean;
      defaultValue?: string;
      value?: string;
      onValueChange?: (value: string) => void;
    }
  | {
      /** Any number of items open independently. */
      type: "multiple";
      collapsible?: never;
      defaultValue?: string[];
      value?: string[];
      onValueChange?: (value: string[]) => void;
    }
);

function Root(props: RootProps) {
  const { children, className } = props;
  const type = props.type ?? "single";
  // Stable per-instance prefix so two Roots reusing the same item value emit
  // distinct, unambiguous DOM ids for the trigger↔panel ARIA wiring.
  const rootId = useId();

  // Uncontrolled state is stored as a string[] internally for both modes; the
  // public single-mode API stays string-shaped via the coercion below.
  const [internal, setInternal] = useState<string[]>(() => {
    if (props.defaultValue === undefined) return [];
    return Array.isArray(props.defaultValue)
      ? props.defaultValue
      : [props.defaultValue];
  });

  const isControlled = props.value !== undefined;
  const openValues: string[] = isControlled
    ? Array.isArray(props.value)
      ? props.value
      : props.value === undefined
        ? []
        : [props.value]
    : internal;

  const emit = (next: string[]) => {
    if (!isControlled) setInternal(next);
    // Narrow on props.type (not the derived `type`) so the discriminated union
    // resolves onValueChange to its single- vs multiple-mode signature.
    if (props.type === "multiple") {
      props.onValueChange?.(next);
    } else {
      // single mode reports a single string ("" when nothing is open)
      props.onValueChange?.(next[0] ?? "");
    }
  };

  const toggle = (itemValue: string) => {
    const currentlyOpen = openValues.includes(itemValue);
    if (type === "multiple") {
      emit(
        currentlyOpen
          ? openValues.filter((v) => v !== itemValue)
          : [...openValues, itemValue],
      );
      return;
    }
    // single
    if (currentlyOpen) {
      const collapsible = props.collapsible ?? true;
      if (collapsible) emit([]);
      return;
    }
    emit([itemValue]);
  };

  const isOpen = (itemValue: string) => openValues.includes(itemValue);
  const triggerId = (itemValue: string) => `${rootId}-trigger-${itemValue}`;
  const contentId = (itemValue: string) => `${rootId}-content-${itemValue}`;

  return (
    <AccordionContext.Provider value={{ isOpen, toggle, triggerId, contentId }}>
      <div data-accordion-root="" className={cn("flex flex-col", className)}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

// ─── Item ─────────────────────────────────────────────────────────────────────

function Item({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { isOpen } = useAccordionContext();
  return (
    <AccordionItemContext.Provider value={value}>
      <div
        data-state={isOpen(value) ? "open" : "closed"}
        className={cn("border-b border-border", className)}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

function Trigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isOpen, toggle, triggerId, contentId } = useAccordionContext();
  const value = useAccordionItemContext();
  const open = isOpen(value);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    // Optional WAI-ARIA accordion navigation between headers. Headers stay in
    // the normal Tab order (no roving tabindex); arrows are an enhancement.
    const root = e.currentTarget.closest("[data-accordion-root]");
    if (!root) return;
    const triggers = Array.from(
      root.querySelectorAll<HTMLElement>("[data-accordion-trigger]"),
    );
    const idx = triggers.indexOf(e.currentTarget);
    if (idx === -1) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      triggers[(idx + 1) % triggers.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      triggers[(idx - 1 + triggers.length) % triggers.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      triggers[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      triggers[triggers.length - 1]?.focus();
    }
  };

  return (
    <button
      type="button"
      data-accordion-trigger=""
      aria-expanded={open}
      aria-controls={contentId(value)}
      id={triggerId(value)}
      onClick={() => toggle(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium transition-colors",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        open ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span className="flex-1">{children}</span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

function Content({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isOpen, triggerId, contentId } = useAccordionContext();
  const value = useAccordionItemContext();
  if (!isOpen(value)) return null;
  return (
    <div
      role="region"
      id={contentId(value)}
      aria-labelledby={triggerId(value)}
      className={cn("pb-4 text-sm", className)}
    >
      {children}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const Accordion = { Root, Item, Trigger, Content };
