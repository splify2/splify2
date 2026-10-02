import React from "react";
import type { ButtonHTMLAttributes, ReactNode, CSSProperties } from "react";
/** Квадратная кнопка-глиф для действий внутри строки списка. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
    /** Обязательно: уходит в aria-label и title. */
    label: string;
    tone?: "muted" | "danger";
    disabled?: boolean;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function IconButton({ label, disabled, tone, children, style, ...rest }: IconButtonProps): React.JSX.Element;
