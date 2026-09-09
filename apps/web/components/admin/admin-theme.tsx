"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";
const STORAGE_KEY = "dammie-admin-theme";
const ThemeContext = createContext<{ theme: Theme | null; toggle: () => void } | null>(null);

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useLayoutEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Storage can be unavailable. */ }
    setTheme(saved === "light" || saved === "dark" ? saved : "dark");
  }, []);

  useLayoutEffect(() => {
    if (!theme) return;
    // Theme the document too so portaled dialogs, mobile navigation, and toasts inherit it.
    const root = document.documentElement;
    const previousDark = root.classList.contains("dark");
    const previousAdmin = root.classList.contains("admin-theme");
    const previousColorScheme = root.style.colorScheme;
    root.classList.add("admin-theme");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    return () => {
      root.classList.toggle("dark", previousDark);
      root.classList.toggle("admin-theme", previousAdmin);
      root.style.colorScheme = previousColorScheme;
    };
  }, [theme]);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the current session usable. */ }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <div className={cn("admin-theme min-h-svh bg-background text-foreground", { dark: theme === "dark" })}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function AdminThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("AdminThemeToggle requires AdminThemeProvider");
  const dark = context.theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button type="button" variant="outline" size="icon" onClick={context.toggle}
      disabled={!context.theme} aria-label={label} title={label}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
