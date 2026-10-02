import React from "react";
import type { ReactNode, CSSProperties } from "react";
/** Подтверждение уже случившегося. Уходит сам через ~3,2 с; кнопок внутри не бывает. */
export interface ToastProps {
    tone?: "ok" | "warn" | "bad";
    children?: ReactNode;
    style?: CSSProperties;
}
/** Правый нижний угол; новые сообщения добавляются снизу. */
export interface ToastStackProps {
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Toast({ tone, children, style }: ToastProps): React.JSX.Element;
export declare function ToastStack({ children, style }: ToastStackProps): React.JSX.Element;
