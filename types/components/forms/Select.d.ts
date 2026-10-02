import React from "react";
import type { SelectHTMLAttributes, ReactNode, CSSProperties } from "react";
/** Выбор одного из многих (версии, устройства, режимы). До трёх вариантов берите SegmentedControl. */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "style" | "size"> {
    size?: "md" | "sm";
    children?: ReactNode;
    style?: CSSProperties;
}
export declare function Select({ size, children, style, ...rest }: SelectProps): React.JSX.Element;
