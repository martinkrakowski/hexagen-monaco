"use client";

import { useTheme } from "../../hooks/use-theme";
import { Sun, Moon } from "lucide-react";

export const Header = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="w-full p-5 pl-6 pb-1 bg-background flex items-center justify-between">
      <h1 className="text-2xl font-bold p-1">
        Hexagen Monaco Project Generator
      </h1>
      <button
        onClick={toggleTheme}
        className="p-2 rounded-lg hover:bg-accent transition-colors"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? (
          <Moon className="w-5 h-5 text-sidebar-foreground" />
        ) : (
          <Sun className="w-5 h-5 text-foreground" />
        )}
      </button>
    </header>
  );
};
