import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";
/** Плашка находки: счётчик в шапке, дословный текст проверки внутри. */
export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "title"> {
    tone?: "warn" | "danger" | "info";
    /** Подпись счётчика без числа: «проверок с предупреждением». */
    title?: ReactNode;
    /** Число ставится через двоеточие — без согласования с подписью. */
    count?: number | null;
    /** Текст проверки ОТ ДВИЖКА, как есть: diag.checks[].what. Не переписывать. */
    verbatim?: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Callout({ tone, count, title, verbatim, action, children, style, ...rest }: CalloutProps): React.JSX.Element;
