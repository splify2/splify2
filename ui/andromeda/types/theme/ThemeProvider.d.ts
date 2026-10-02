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
import { type ReactNode } from "react";
export type ThemeMode = "light" | "dark" | "system";
/** Акценты, которые хост вправе выбрать. Оттенки те же, что в tokens/accents.css. */
export declare const ACCENTS: readonly [{
    readonly key: "indigo";
    readonly title: "индиго · Andromeda";
    readonly hex: "#5e72e4";
    readonly press: "#4453b8";
}, {
    readonly key: "dns";
    readonly title: "оранжевый · ДНС";
    readonly hex: "#c2410c";
    readonly press: "#9a3409";
}, {
    readonly key: "violet";
    readonly title: "фиолетовый";
    readonly hex: "#7c5cff";
    readonly press: "#5f43d6";
}];
export type Accent = (typeof ACCENTS)[number]["key"];
interface ThemeState {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
    dark: boolean;
    accent: Accent;
    setAccent: (accent: Accent) => void;
}
export interface ThemeProviderProps {
    children?: ReactNode;
    /** Префикс ключей localStorage: `<prefix>-theme`, `<prefix>-accent`. */
    storagePrefix?: string;
    defaultMode?: ThemeMode;
    defaultAccent?: Accent;
}
export declare function ThemeProvider({ children, storagePrefix, defaultMode, defaultAccent }: ThemeProviderProps): import("react").JSX.Element;
export declare const useTheme: () => ThemeState;
export {};
