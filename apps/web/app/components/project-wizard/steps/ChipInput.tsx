"use client";

import { useState, type KeyboardEvent } from "react";

interface ChipInputProps {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  name: string;
}

export function ChipInput({
  label,
  placeholder,
  values,
  onChange,
  name,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      if (!values.includes(inputValue.trim())) {
        onChange([...values, inputValue.trim()]);
      }
      setInputValue("");
    }
  };

  const handleRemove = (valueToRemove: string) => {
    onChange(values.filter((v) => v !== valueToRemove));
  };

  const handleBlur = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue("");
  };

  return (
    <div className="mb-4">
      <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <div className="p-3 border border-dashed border-input rounded-lg focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-[box-shadow,border-color]">
        <div className="flex flex-wrap gap-1">
          {values.map((val) => (
            <span
              key={val}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border border-border text-xs font-medium shadow-sm h-6"
            >
              {val}
              <button
                type="button"
                aria-label={`Remove ${val}`}
                onClick={() => handleRemove(val)}
                className="text-destructive hover:text-destructive/80 ml-0.5 text-sm font-bold leading-none"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <input
          name={name}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={values.length === 0 ? placeholder : "Add..."}
          className="w-full mt-1 bg-transparent outline-none text-sm text-foreground placeholder-muted-foreground"
        />
      </div>
    </div>
  );
}
