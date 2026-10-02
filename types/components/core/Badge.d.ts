import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";
/** Ярлык состояния или роли рядом с именем объекта. */
export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
    tone?: "neutral" | "accent" | "solid" | "success" | "warn" | "danger";
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Badge({ tone, children, style, ...rest }: BadgeProps): React.JSX.Element;
