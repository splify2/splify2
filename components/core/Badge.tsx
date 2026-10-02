import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";


const TONE = {
  neutral: { background: "var(--an-surface-field)", color: "var(--an-text-secondary)" },
  accent: { background: "var(--an-accent-soft)", color: "var(--an-accent)" },
  solid: { background: "var(--an-accent)", color: "var(--an-text-on-accent)" },
  success: { background: "var(--an-success-soft)", color: "var(--an-success-ink)" },
  warn: { background: "var(--an-warn-soft)", color: "var(--an-warn-ink)" },
  danger: { background: "var(--an-danger-soft)", color: "var(--an-danger-ink)" },
};

/** Ярлык состояния или роли рядом с именем объекта. */
export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
  tone?: "neutral" | "accent" | "solid" | "success" | "warn" | "danger";
  children?: ReactNode;
  style?: CSSProperties;
}

export function Badge({ tone = "neutral", children, style, ...rest }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 20,
        padding: "0 8px",
        borderRadius: "var(--an-radius-badge)",
        font: "var(--an-text-micro)",
        fontWeight: "var(--an-weight-medium)",
        whiteSpace: "nowrap",
        transition: "var(--an-transition-theme)",
        ...TONE[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
