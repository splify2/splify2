import React from "react";
import type { SelectHTMLAttributes, ReactNode, CSSProperties } from "react";


/** Выбор одного из многих (версии, устройства, режимы). До трёх вариантов берите SegmentedControl. */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "style" | "size"> {
  size?: "md" | "sm";
  children?: ReactNode;
  style?: CSSProperties;
}

export function Select({ size = "md", children, style, ...rest }: SelectProps) {
  return (
    <select
      style={{
        height: size === "sm" ? "var(--an-size-control-sm)" : "var(--an-size-control)",
        padding: "0 10px",
        borderRadius: "var(--an-radius-control)",
        border: "1px solid var(--an-border)",
        background: "var(--an-surface-input)",
        color: "var(--an-text)",
        font: "var(--an-text-body-sm)",
        cursor: "pointer",
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
}
