"use client";

interface HexagonLabelTextProps {
  label: string;
}

export function HexagonLabelText({ label }: HexagonLabelTextProps) {
  return (
    <div className="text-center text-foreground uppercase tracking-widest leading-tight text-base font-black italic">
      {String(label || "")
        .split("\n")
        .map((line, lineIdx) => (
          <span
            key={`${line}-${lineIdx}`}
            className={
              lineIdx > 0
                ? "opacity-50 text-xs lowercase mt-1 font-normal tracking-normal normal-case"
                : ""
            }
          >
            {line}
          </span>
        ))}
    </div>
  );
}
