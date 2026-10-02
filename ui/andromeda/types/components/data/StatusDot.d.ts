import React from "react";
import type { CSSProperties } from "react";
/** Точка состояния. Единственный элемент, чей цвет НЕ зависит от акцента темы. */
export interface StatusDotProps {
    tone?: "ok" | "warn" | "bad" | "off";
    /** 8 в строках, 11 рядом с вердиктом. */
    size?: number;
    /** Пульс: значение живое, читается прямо сейчас. */
    live?: boolean;
    label?: string;
    style?: CSSProperties;
}
export declare function StatusDot({ tone, size, live, label, style }: StatusDotProps): React.JSX.Element;
