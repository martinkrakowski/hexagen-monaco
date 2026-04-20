import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";

export type IconName =
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "close"
  | "copy"
  | "download"
  | "edit"
  | "eye"
  | "eye-off"
  | "filter"
  | "info"
  | "link"
  | "menu"
  | "more-vertical"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "trash"
  | "upload"
  | "warning"
  | "x";

export interface IconProps extends HTMLAttributes<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const iconPaths: Record<IconName, string> = {
  check: "M20 6L9 17l-5-5",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-left": "M15 18l-6-6 6-6",
  "chevron-right": "M9 18l6-6-6-6",
  "chevron-up": "M18 12l-6-6-6 6",
  close: "M18 6L6 18M6 6l12 12",
  copy: "M8 4h8v8M4 8v8h8",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7",
  eye: "M1 12s4-8 11-8 11 8 4 8 4 8-4 8-11 8-8 8-8S20 12 20 12s-4 8-11 8-8 8-4 8-4 8-11 8-8 8-8S1 12 1 12",
  "eye-off": "M17.94 17.94A10.07 10.07 0 0112 20c4.42 0 8-3.42 8-8 0-1.12-.23-2.2-.64-3.22M1 1l22 22M4.34 4.34A10 10 0 0112 4c4.42 0 8 3.42 8 8 0 1.12-.23 2.2-.64 3.22",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  info: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 5v4m0 4v2",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  menu: "M3 12h18M3 6h18M3 18h18",
  "more-vertical": "M12 12h9M12 3v18",
  plus: "M12 5v14M5 12h14",
  refresh: "M23 4v6h-6M1 20v-6h6M20.5 9A9.5 9 0 0111 4M3.5 15A9.5 9 0 0113 20",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  settings: "M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08M22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08M12 2v2M6.6 18.44l.15.08M17.4 18.44l.15-.08",
  trash: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
  warning: "M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z",
  x: "M18 6L6 18M6 6l12 12",
};

const IconComponent: ForwardRefRenderFunction<SVGSVGElement, IconProps> = (
  { name, size = 24, className, ...props },
  ref
) => {
  const path = iconPaths[name];
  if (!path) return null;

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d={path} />
    </svg>
  );
};

export const Icon = forwardRef(IconComponent);
Icon.displayName = "Icon";