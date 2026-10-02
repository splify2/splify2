import React from "react";
import type { ButtonHTMLAttributes, ReactNode, CSSProperties } from "react";
/**
 * Andromeda action button.
 *
 * @startingPoint section="Core" subtitle="Действия: основное, второстепенное, призрачное, опасное" viewport="700x150"
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
    /** primary — одно на экран; secondary — рядом с ним; ghost — в плотных рядах; danger — снос. */
    tone?: "primary" | "secondary" | "ghost" | "danger";
    size?: "md" | "sm";
    /** Крутит иконку и блокирует повторное нажатие, пока роутер отвечает. */
    busy?: boolean;
    disabled?: boolean;
    /** 16×16 глиф из спрайта или lucide. */
    icon?: ReactNode;
    full?: boolean;
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Button({ tone, size, busy, disabled, icon, full, children, style, ...rest }: ButtonProps): React.JSX.Element;
