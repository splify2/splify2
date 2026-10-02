/**
 * Тема и акцент. Восстановлено 2026-09-24 по собранному бандлу панели
 * «Солнечный» (dnsgo-sdk, сборка 2026-09-09): исходник модуля потерялся вместе
 * с машиной автора, а в экспорте дизайн-системы его не было. Поведение взято
 * из бандла один в один — те же ключи хранения, те же значения по умолчанию,
 * те же атрибуты на <html>, — чтобы выбор, сделанный в старой сборке, читался
 * новой без потерь.
 *
 * Тёмная тема — атрибут data-theme="dark" и класс dark на <html> (атрибут
 * читают токены системы, класс — хосты на Tailwind). Акцент — data-accent;
 * у индиго атрибута нет, это значения colors.css по умолчанию.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

/** Акценты, которые хост вправе выбрать. Оттенки те же, что в tokens/accents.css. */
export const ACCENTS = [
  { key: "indigo", title: "индиго · Andromeda", hex: "#5e72e4", press: "#4453b8" },
  { key: "dns", title: "оранжевый · ДНС", hex: "#c2410c", press: "#9a3409" },
  { key: "violet", title: "фиолетовый", hex: "#7c5cff", press: "#5f43d6" },
] as const;

export type Accent = (typeof ACCENTS)[number]["key"];

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  dark: boolean;
  accent: Accent;
  setAccent: (accent: Accent) => void;
}

const ThemeContext = createContext<ThemeState>({
  mode: "light", setMode: () => {}, dark: false, accent: "indigo", setAccent: () => {},
});

function systemDark(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved && (allowed as readonly string[]).includes(saved) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

export interface ThemeProviderProps {
  children?: ReactNode;
  /** Префикс ключей localStorage: `<prefix>-theme`, `<prefix>-accent`. */
  storagePrefix?: string;
  defaultMode?: ThemeMode;
  defaultAccent?: Accent;
}

export function ThemeProvider({ children, storagePrefix = "an", defaultMode = "light", defaultAccent = "indigo" }: ThemeProviderProps) {
  const themeKey = `${storagePrefix}-theme`;
  const accentKey = `${storagePrefix}-accent`;
  const [mode, setMode] = useState<ThemeMode>(() => read<ThemeMode>(themeKey, ["light", "dark", "system"], defaultMode));
  const [accent, setAccent] = useState<Accent>(() => read<Accent>(accentKey, ACCENTS.map((a) => a.key), defaultAccent));
  const dark = mode === "dark" || (mode === "system" && systemDark());

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem(themeKey, mode);
    } catch { /* приватный режим — просто не запоминаем */ }
  }, [mode, dark, themeKey]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === "indigo") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", accent);
    try {
      localStorage.setItem(accentKey, accent);
    } catch { /* приватный режим — просто не запоминаем */ }
  }, [accent, accentKey]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, dark, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
